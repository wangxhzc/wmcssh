import { useCallback, useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readDir } from "@tauri-apps/plugin-fs";
import {
  enqueueDownloadRemotePath,
  enqueueUploadRemoteDirectory,
  enqueueUploadRemoteFile,
  listRemoteDirectory,
  localUploadKind,
  openFileTransferSession
} from "../../../services/tauri/fileTransferApi";
import { useTerminalStore } from "../../../stores/terminalStore";
import { useTransferQueueStore } from "../../../stores/transferQueueStore";
import { CustomScrollbar } from "../../../app/CustomScrollbar";
import { normalizeAppError, type AppErrorDto } from "../../../types/errors";
import type {
  FileTransferLoadState,
  RemoteFileEntry,
  TransferProgress,
  UploadRemoteDirectoryFilePayload
} from "../../../types/fileTransfer";
import { useAnchoredMenuPosition } from "../../../app/useAnchoredMenuPosition";
import { confirmAndTrustHostKey } from "../../hosts/hostKeyTrust";
import { getHost } from "../../../services/tauri/hostApi";
import { requestConnectionCredentials } from "../../hosts/connectionCredentials";
import { rememberConnectionCredentials } from "../../terminal/actions";
import { TransferQueuePanel } from "./TransferQueuePanel";
import { formatTransferBytes } from "../transferQueue";
import { useFileDrop } from "../useFileDrop";
import { selectFile, reconcileSelection, type FileSelection } from "../fileSelection";
import type { ListRemoteDirectoryResult } from "../../../types/fileTransfer";

type FileTransferViewProps = {
  tabId: string;
  hostId: string;
  transferSessionId?: string;
  active: boolean;
};

const MAX_DIRECTORY_FILE_COUNT = 1000;
const MAX_DIRECTORY_DEPTH = 10;
const DIRECTORY_LIMIT_MESSAGE = "文件数量过多请打包后上传或下载";

function parentPath(path: string) {
  if (path === "/") return "/";
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const index = trimmed.lastIndexOf("/");
  if (index <= 0) return "/";
  return trimmed.slice(0, index);
}

function pathName(path: string) {
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop();
}

function joinLocalPath(parent: string, child: string) {
  const separator = parent.includes("\\") ? "\\" : "/";
  return `${parent.replace(/[/\\]+$/, "")}${separator}${child}`;
}

function relativeDepth(path: string) {
  return path.split("/").filter(Boolean).length;
}

async function collectLocalDirectoryPayload(rootPath: string) {
  const directories: string[] = [];
  const files: UploadRemoteDirectoryFilePayload[] = [];

  async function visit(currentPath: string, relativeDirPath: string, depth: number) {
    if (depth > MAX_DIRECTORY_DEPTH) {
      throw new Error(DIRECTORY_LIMIT_MESSAGE);
    }

    const entries = await readDir(currentPath);
    for (const entry of entries) {
      const childPath = joinLocalPath(currentPath, entry.name);
      const relativePath = relativeDirPath ? `${relativeDirPath}/${entry.name}` : entry.name;

      if (relativeDepth(relativePath) > MAX_DIRECTORY_DEPTH) {
        throw new Error(DIRECTORY_LIMIT_MESSAGE);
      }

      if (entry.isDirectory) {
        directories.push(relativePath);
        await visit(childPath, relativePath, depth + 1);
        continue;
      }

      if (!entry.isFile) continue;

      if (files.length >= MAX_DIRECTORY_FILE_COUNT) {
        throw new Error(DIRECTORY_LIMIT_MESSAGE);
      }

      files.push({
        relativePath,
        localFilePath: childPath
      });
    }
  }

  await visit(rootPath, "", 0);
  return { directories, files };
}

export function FileTransferView({ tabId, hostId, transferSessionId, active }: FileTransferViewProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const dropTargetRef = useRef<HTMLDivElement | null>(null);
  const dropSubmitting = useRef(false);
  const [state, setState] = useState<FileTransferLoadState>({ status: "idle" });
  const [directory, setDirectory] = useState<ListRemoteDirectoryResult>();
  const [selection, setSelection] = useState<FileSelection>({ paths: [] });
  const selectedEntries = directory?.entries.filter((entry) => selection.paths.includes(entry.path)) ?? [];
  const requestedPath = useRef<string | undefined>(undefined);
  const loadVersion = useRef(0);
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [queueVisible, setQueueVisible] = useState(false);
  const [queueManuallyOpened, setQueueManuallyOpened] = useState(false);
  const [queueHeight, setQueueHeight] = useState(180);
  const [contextMenu, setContextMenu] = useState<{ entry: RemoteFileEntry; x: number; y: number } | null>(null);
  const [uploadMenu, setUploadMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const uploadMenuRef = useRef<HTMLDivElement | null>(null);
  const contextMenuPosition = useAnchoredMenuPosition(contextMenu, menuRef);
  const uploadMenuPosition = useAnchoredMenuPosition(uploadMenu, uploadMenuRef);
  const bindFileTransferSession = useTerminalStore((store) => store.bindFileTransferSession);
  const applyTransferProgress = useTransferQueueStore((store) => store.applyProgress);
  const upsertTransferTask = useTransferQueueStore((store) => store.upsertTask);
  const tasks = useTransferQueueStore((store) => store.tasks);
  const loadTasks = useTransferQueueStore((store) => store.loadTasks);
  const refreshedUploads = useRef(new Set<string>());
  const pendingUploadRefreshes = useRef(new Set<string>());
  const sessionTasks = tasks.filter((task) => task.transferSessionId === transferSessionId);
  const hasPendingTransfers = sessionTasks.some((task) => task.status === "queued" || task.status === "running");
  const completedUploadIds = sessionTasks
    .filter((task) => task.direction === "upload" && task.status === "completed")
    .map((task) => task.transferId).sort().join(",");
  const canAutoCloseQueue = sessionTasks.length > 0
    && sessionTasks.every((task) => task.status === "completed" || task.status === "cancelled");

  useEffect(() => {
    if (!transferSessionId) return;
    void loadTasks();
    const timer = window.setInterval(() => void loadTasks(), 1000);
    return () => window.clearInterval(timer);
  }, [loadTasks, transferSessionId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(undefined), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (directory?.fallbackToRoot) setNotice("未获取到用户家目录，已自动回退到根目录 `/`。");
  }, [directory?.fallbackToRoot]);

  useEffect(() => {
    if (!queueVisible || queueManuallyOpened || !canAutoCloseQueue) return;
    const timer = window.setTimeout(() => setQueueVisible(false), 3000);
    return () => window.clearTimeout(timer);
  }, [queueVisible, queueManuallyOpened, canAutoCloseQueue]);

  const createProgressChannel = (transferId: string) => {
    const channel = new Channel<TransferProgress>();
    channel.onmessage = (progress) => {
      if (progress.transferId !== transferId) return;
      applyTransferProgress(progress);
    };
    return channel;
  };

  const dropHovered = useFileDrop(dropTargetRef, active && !busy && state.status === "ready" && !!transferSessionId,
    async (paths) => {
      if (dropSubmitting.current || busy || state.status !== "ready" || !transferSessionId) return;
      dropSubmitting.current = true;
      setBusy(true);
      setContextMenu(null);
      setUploadMenu(null);
      setNotice(undefined);
      const remoteDirPath = state.path;
      let submitted = 0;
      const errors: string[] = [];
      try {
        for (const localPath of new Set(paths)) {
          try {
            const name = pathName(localPath);
            if (!name) throw new Error("文件名无效");
            const kind = await localUploadKind(localPath);
            const transferId = crypto.randomUUID();
            const channel = createProgressChannel(transferId);
            const task = kind === "directory"
              ? await enqueueUploadRemoteDirectory({
                transferId, transferSessionId, remoteDirPath, directoryName: name,
                ...await collectLocalDirectoryPayload(localPath)
              }, channel)
              : await enqueueUploadRemoteFile({
                transferId, transferSessionId, remoteDirPath, fileName: name, localFilePath: localPath
              }, channel);
            upsertTransferTask(task);
            submitted += 1;
            setQueueVisible(true);
          } catch (error) {
            errors.push(`${pathName(localPath) ?? localPath}：${normalizeAppError(error).message}`);
          }
        }
        setNotice(errors.length
          ? `已加入 ${submitted} 个上传任务；${errors.length} 项失败：${errors.join("；")}`
          : `已将 ${submitted} 个项目加入后台上传队列`);
      } finally {
        dropSubmitting.current = false;
        setBusy(false);
      }
    }, (error) => setNotice(`拖拽上传失败：${normalizeAppError(error).message}`));

  const loadDirectory = useCallback(
    async (path?: string) => {
      const version = ++loadVersion.current;
      requestedPath.current = path;
      setState({ status: "loading" });
      try {
        let activeTransferSessionId = transferSessionId;
        if (!activeTransferSessionId) {
          let result;
          try {
            result = await openFileTransferSession({ hostId });
          } catch (cause) {
            const appError = normalizeAppError(cause);
            const needsCredentials = appError.code === "auth_failed"
              || appError.code === "secret_not_found"
              || appError.code === "host_invalid";
            if (!needsCredentials) throw appError;

            let host = await getHost(hostId);
            const credentials = await requestConnectionCredentials(host, {
              force: true,
              message: `文件传输认证失败：${appError.message}`
            });
            if (!credentials) throw appError;
            host = await rememberConnectionCredentials(host, credentials);
            result = await openFileTransferSession({
              hostId: host.id,
              username: credentials.username?.trim() || undefined,
              authType: credentials.authType,
              password: credentials.password,
              privateKeyPath: credentials.privateKeyPath,
              privateKeyPassphrase: credentials.privateKeyPassphrase
            });
          }
          activeTransferSessionId = result.transferSessionId;
          bindFileTransferSession(tabId, activeTransferSessionId);
        }

        const result = await listRemoteDirectory({ transferSessionId: activeTransferSessionId, path });
        if (version !== loadVersion.current) return;
        requestedPath.current = result.path;
        setDirectory(result);
        setSelection((previous) => reconcileSelection(previous, result.path, result.entries.map((entry) => entry.path)));
        setContextMenu(null);
        setState({
          status: "ready",
          path: result.path,
          entries: result.entries,
          fallbackToRoot: result.fallbackToRoot
        });
      } catch (error) {
        if (version !== loadVersion.current) return;
        setState({ status: "error", error: error as AppErrorDto });
      }
    },
    [bindFileTransferSession, hostId, tabId, transferSessionId]
  );

  useEffect(() => {
    if (!active) return;
    if (state.status === "idle") {
      void loadDirectory();
    }
  }, [active, loadDirectory, state.status]);

  useEffect(() => {
    completedUploadIds.split(",").forEach((id) => {
      if (id && !refreshedUploads.current.has(id)) pendingUploadRefreshes.current.add(id);
    });
    if (!active || !directory || hasPendingTransfers || state.status === "loading") return;
    const pendingIds = [...pendingUploadRefreshes.current];
    if (pendingIds.length === 0) return;
    // Allow the worker to release the SFTP session before reading the directory.
    const timer = window.setTimeout(() => {
      pendingIds.forEach((id) => {
        refreshedUploads.current.add(id);
        pendingUploadRefreshes.current.delete(id);
      });
      void loadDirectory(directory.path);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [active, completedUploadIds, directory, hasPendingTransfers, loadDirectory, state.status]);

  useEffect(() => {
    if (!contextMenu && !uploadMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current?.contains(target)) return;
      if (uploadMenuRef.current?.contains(target)) return;
      setContextMenu(null);
      setUploadMenu(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
        setUploadMenu(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu, uploadMenu]);

  useEffect(() => {
    if (!notice) return;

    const timer = window.setTimeout(() => {
      setNotice(undefined);
    }, 3000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [notice]);

  const handleUploadClick = () => {
    if (busy || state.status !== "ready") return;
    if (!transferSessionId) {
      setNotice("上传失败：文件传输会话未就绪");
      return;
    }
    setUploadMenu(null);
    void (async () => {
      const selected = await open({
        multiple: false,
        directory: false
      });

      if (!selected || Array.isArray(selected)) {
        return;
      }

      const filePath = selected;
      const fileName = filePath.split(/[/\\\\]/).pop();
      if (!fileName) {
        setNotice("上传失败：文件名无效");
        return;
      }

      setBusy(true);
      setNotice(undefined);
      const transferId = crypto.randomUUID();
      const progressChannel = createProgressChannel(transferId);

      try {
        const task = await enqueueUploadRemoteFile({
          transferId,
          transferSessionId,
          remoteDirPath: state.path,
          fileName,
          localFilePath: filePath
        }, progressChannel);
        upsertTransferTask(task);
        setQueueVisible(true);
        setNotice(`已将 ${fileName} 加入后台上传队列`);
      } catch (error) {
        console.error("[wmcssh][file-transfer] enqueue upload failed", error);
        const appError = error as AppErrorDto;
        const message = appError.message ?? String(error);
        setNotice(`加入上传队列失败：${message}`);
      } finally {
        setBusy(false);
      }
    })();
  };

  const handleUploadDirectoryClick = () => {
    if (busy || state.status !== "ready") return;
    if (!transferSessionId) {
      setNotice("上传失败：文件传输会话未就绪");
      return;
    }
    setUploadMenu(null);
    void (async () => {
      const selected = await open({
        multiple: false,
        directory: true
      });

      if (!selected || Array.isArray(selected)) {
        return;
      }

      const directoryPath = selected;
      const directoryName = pathName(directoryPath);
      if (!directoryName) {
        setNotice("上传失败：目录名无效");
        return;
      }

      setBusy(true);
      setNotice(undefined);
      const transferId = crypto.randomUUID();
      const progressChannel = createProgressChannel(transferId);

      try {
        const payload = await collectLocalDirectoryPayload(directoryPath);
        const task = await enqueueUploadRemoteDirectory({
          transferId,
          transferSessionId,
          remoteDirPath: state.path,
          directoryName,
          directories: payload.directories,
          files: payload.files
        }, progressChannel);
        upsertTransferTask(task);
        setQueueVisible(true);
        setNotice(`已将目录 ${directoryName} 加入后台上传队列`);
      } catch (error) {
        console.error("[wmcssh][file-transfer] enqueue directory upload failed", error);
        const message = error instanceof Error ? error.message : (error as AppErrorDto).message ?? String(error);
        setNotice(`加入上传队列失败：${message}`);
      } finally {
        setBusy(false);
      }
    })();
  };

  const handleDownload = async (entry: RemoteFileEntry) => {
    if (busy) return;
    if (!transferSessionId) {
      setNotice("下载失败：文件传输会话未就绪");
      return;
    }

    setBusy(true);
    setNotice(undefined);
    setContextMenu(null);

    try {
      let localPath: string;
      if (entry.entryType === "directory") {
        const targetRoot = await open({
          multiple: false,
          directory: true
        });

        if (!targetRoot || Array.isArray(targetRoot)) {
          setNotice("下载已取消");
          return;
        }
        localPath = joinLocalPath(targetRoot, entry.name);
      } else {
        const targetPath = await save({ defaultPath: entry.name });
        if (!targetPath) {
          setNotice("下载已取消");
          return;
        }
        localPath = targetPath;
      }

      const transferId = crypto.randomUUID();
      const progressChannel = createProgressChannel(transferId);
      const task = await enqueueDownloadRemotePath({
        transferId,
        transferSessionId,
        remotePath: entry.path,
        localPath
      }, progressChannel);
      upsertTransferTask(task);
      setQueueVisible(true);
      setNotice(`已将 ${entry.name} 加入后台下载队列`);
    } catch (error) {
      console.error("[wmcssh][file-transfer] enqueue download failed", error);
      if (error === null || error === undefined) {
        setNotice("下载已取消");
        return;
      }

      if (typeof error === "string") {
        setNotice(`加入下载队列失败：${error}`);
        return;
      }

      const appError = error as AppErrorDto;
      if (typeof appError === "object" && appError !== null && "message" in appError) {
        setNotice(`加入下载队列失败：${String(appError.message)}`);
        return;
      }

      setNotice(`加入下载队列失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const downloadSelection = async () => {
    if (busy || !transferSessionId || selectedEntries.length === 0) return;
    if (selectedEntries.length === 1) return handleDownload(selectedEntries[0]);
    const entries = selectedEntries;
    setBusy(true);
    setContextMenu(null);
    try {
      const root = await open({ multiple: false, directory: true });
      if (!root || Array.isArray(root)) return;
      let submitted = 0;
      const errors: string[] = [];
      for (const entry of entries) {
        try {
          const transferId = crypto.randomUUID();
          const task = await enqueueDownloadRemotePath({
            transferId, transferSessionId, remotePath: entry.path, localPath: joinLocalPath(root, entry.name)
          }, createProgressChannel(transferId));
          upsertTransferTask(task);
          submitted += 1;
          setQueueVisible(true);
        } catch (error) {
          errors.push(`${entry.name}：${normalizeAppError(error).message}`);
        }
      }
      setNotice(`已加入 ${submitted} 个下载任务${errors.length ? `；失败：${errors.join("；")}` : ""}`);
    } catch (error) {
      setNotice(`下载失败：${normalizeAppError(error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleCopyPath = async () => {
    setContextMenu(null);

    try {
      await navigator.clipboard.writeText(selectedEntries.map((entry) => entry.path).join("\n"));
      setNotice("已复制路径");
    } catch (error) {
      console.error("[wmcssh][file-transfer] copy path failed", error);
      setNotice("复制路径失败");
    }
  };

  const handleTrustHostKey = async (error: AppErrorDto) => {
    try {
      const trusted = await confirmAndTrustHostKey(hostId, error);
      if (trusted) await loadDirectory(requestedPath.current);
    } catch (cause) {
      setState({ status: "error", error: normalizeAppError(cause) });
    }
  };

  const renderRow = (entry: RemoteFileEntry, index: number) => {
    const isDirectory = entry.entryType === "directory";

    return (
      <div
        key={entry.path}
        id={`file-entry-${tabId}-${index}`}
        role="option"
        aria-selected={selection.paths.includes(entry.path)}
        className={`file-transfer-entry${selection.paths.includes(entry.path) ? " selected" : ""}${selection.focus === entry.path ? " focused" : ""}`}
        onClick={(event) => {
          if (state.status === "loading") return;
          listRef.current?.focus();
          setSelection((previous) => selectFile(previous, directory?.entries.map((item) => item.path) ?? [], entry.path,
            { range: event.shiftKey, toggle: event.ctrlKey || event.metaKey }));
        }}
        onDoubleClick={(event) => {
          if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !busy && state.status !== "loading" && isDirectory) {
            void loadDirectory(entry.path);
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (state.status === "loading") return;
          listRef.current?.focus();
          setSelection((previous) => previous.paths.includes(entry.path)
            ? { ...previous, focus: entry.path }
            : { ...previous, paths: [entry.path], anchor: entry.path, focus: entry.path });
          setContextMenu({
            entry,
            x: event.clientX,
            y: event.clientY
          });
        }}
      >
        <span className={`file-transfer-entry-icon ${entry.entryType}`}>{isDirectory ? "DIR" : "FILE"}</span>
        <span className="file-transfer-entry-name" title={entry.name}>{entry.name}</span>
        <span className="file-transfer-entry-meta">
          {isDirectory ? "目录" : entry.size !== undefined ? formatTransferBytes(entry.size) : "大小未知"}
        </span>
      </div>
    );
  };

  return (
    <div ref={dropTargetRef} className={`file-transfer-view${dropHovered ? " drop-hovered" : ""}`}>
      <div className="file-transfer-toolbar">
        <button
          type="button"
          className="ghost-button"
          disabled={busy || state.status !== "ready" || state.path === "/"}
          onClick={() => {
            if (state.status !== "ready") return;
            void loadDirectory(parentPath(state.path));
          }}
        >
          返回上级
        </button>
        <button
          type="button"
          className="ghost-button"
          disabled={busy || state.status === "loading"}
          onClick={() => {
            void loadDirectory(requestedPath.current);
          }}
        >
          刷新
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={busy || state.status !== "ready"}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setUploadMenu({ x: rect.left, y: rect.bottom + 6 });
          }}
        >
          上传
        </button>
        <button
          type="button"
          className={`ghost-button${queueVisible ? " active" : ""}`}
          onClick={() => {
            setQueueManuallyOpened(!queueVisible);
            setQueueVisible(!queueVisible);
          }}
          aria-expanded={queueVisible}
          aria-controls={`transfer-queue-${tabId}`}
        >
          传输队列
        </button>
        <div className="file-transfer-path">
          {directory?.path ?? requestedPath.current ?? (state.status === "error" ? "尚未载入目录" : "正在连接远程目录...")}
        </div>
        <button type="button" className="ghost-button" disabled={busy || state.status === "loading" || selectedEntries.length === 0}
          onClick={() => void downloadSelection()}>
          {selectedEntries.length ? `下载 (${selectedEntries.length})` : "下载"}
        </button>
      </div>

      <div className="file-transfer-notifications">
      {notice ? <div key={notice} className="file-transfer-note transient" role="status">{notice}</div> : null}

      {state.status === "loading" ? <div className="file-transfer-note" role="status">{directory ? "正在刷新目录..." : "正在加载远程目录..."}</div> : null}

      {state.status === "error" ? (
        <div className="file-transfer-message file-transfer-error">
          <div>目录加载失败：{state.error.message}</div>
          {(state.error.code === "host_key_unknown" || state.error.code === "host_key_mismatch") ? (
            <button type="button" className="ghost-button" onClick={() => void handleTrustHostKey(state.error)}>
              {state.error.code === "host_key_mismatch" ? "核对并更新密钥" : "核对并信任"}
            </button>
          ) : null}
          {state.error.code !== "host_key_unknown" && state.error.code !== "host_key_mismatch" ? (
            <button type="button" className="ghost-button" onClick={() => void loadDirectory(requestedPath.current)}>
              重试
            </button>
          ) : null}
        </div>
      ) : null}

      </div>

      {directory ? (
        <>
          <div className="file-transfer-list-scroll-area">
            <div ref={listRef} className="file-transfer-list" role="listbox" aria-label="远端文件" aria-multiselectable="true" tabIndex={0}
              aria-activedescendant={selection.focus ? `file-entry-${tabId}-${directory.entries.findIndex((entry) => entry.path === selection.focus)}` : undefined}
              onClick={(event) => {
                if (!(event.target as HTMLElement).closest('[role="option"]')) {
                  setSelection({ paths: [], directory: directory.path });
                  setContextMenu(null);
                }
              }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget || state.status === "loading" || contextMenu) return;
                const entries = directory.entries;
                const order = entries.map((entry) => entry.path);
                const modifier = event.ctrlKey || event.metaKey;
                if (modifier && event.key.toLowerCase() === "a") {
                  event.preventDefault();
                  setSelection({ ...selection, paths: order, anchor: selection.anchor ?? order[0], focus: selection.focus ?? order[0] });
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setSelection({ paths: [], directory: directory.path });
                } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && entries.length) {
                  event.preventDefault();
                  const current = order.indexOf(selection.focus ?? "");
                  const index = event.key === "Home" ? 0 : event.key === "End" ? entries.length - 1
                    : current < 0 ? (event.key === "ArrowUp" ? entries.length - 1 : 0)
                    : Math.max(0, Math.min(entries.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)));
                  const path = order[index];
                  setSelection((previous) => modifier && !event.shiftKey ? { ...previous, focus: path }
                    : selectFile(previous, order, path, { range: event.shiftKey, toggle: modifier }));
                  document.getElementById(`file-entry-${tabId}-${index}`)?.scrollIntoView({ block: "nearest" });
                } else if (event.key === " " && selection.focus) {
                  event.preventDefault();
                  setSelection((previous) => selectFile(previous, order, selection.focus!, { toggle: modifier, range: event.shiftKey }));
                } else if (event.key === "Enter" && !busy) {
                  const entry = entries.find((item) => item.path === selection.focus);
                  if (entry?.entryType === "directory") {
                    event.preventDefault();
                    void loadDirectory(entry.path);
                  }
                }
              }}>
              {directory.entries.length > 0 ? directory.entries.map(renderRow) : (
                <div className="file-transfer-message">当前目录为空。</div>
              )}
            </div>
            <CustomScrollbar scrollRef={listRef} />
          </div>
        </>
      ) : null}

      {queueVisible ? (
        <TransferQueuePanel id={`transfer-queue-${tabId}`} transferSessionId={transferSessionId}
          height={queueHeight} onHeightChange={setQueueHeight} />
      ) : null}

      {contextMenu ? (
        <div
          ref={menuRef}
          className="app-context-menu file-transfer-context-menu"
          style={{ left: contextMenuPosition?.x ?? contextMenu.x, top: contextMenuPosition?.y ?? contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <button
            type="button"
            disabled={busy || state.status === "loading"}
            onClick={() => void downloadSelection()}
          >
            下载{selectedEntries.length > 1 ? ` (${selectedEntries.length})` : ""}
          </button>
          <button
            type="button"
            onClick={() => void handleCopyPath()}
          >
            复制路径
          </button>
        </div>
      ) : null}

      {uploadMenu ? (
        <div
          ref={uploadMenuRef}
          className="app-context-menu"
          style={{ left: uploadMenuPosition?.x ?? uploadMenu.x, top: uploadMenuPosition?.y ?? uploadMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <button type="button" disabled={busy} onClick={handleUploadClick}>
            上传文件
          </button>
          <button type="button" disabled={busy} onClick={handleUploadDirectoryClick}>
            上传目录
          </button>
        </div>
      ) : null}
    </div>
  );
}
