import { useCallback, useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readDir } from "@tauri-apps/plugin-fs";
import {
  enqueueDownloadRemotePath,
  enqueueUploadRemoteDirectory,
  enqueueUploadRemoteFile,
  listRemoteDirectory,
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
import { TransferQueue } from "./TransferQueue";

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
  const [state, setState] = useState<FileTransferLoadState>({ status: "idle" });
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [queueVisible, setQueueVisible] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ entry: RemoteFileEntry; x: number; y: number } | null>(null);
  const [uploadMenu, setUploadMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const uploadMenuRef = useRef<HTMLDivElement | null>(null);
  const contextMenuPosition = useAnchoredMenuPosition(contextMenu, menuRef);
  const uploadMenuPosition = useAnchoredMenuPosition(uploadMenu, uploadMenuRef);
  const bindFileTransferSession = useTerminalStore((store) => store.bindFileTransferSession);
  const applyTransferProgress = useTransferQueueStore((store) => store.applyProgress);
  const upsertTransferTask = useTransferQueueStore((store) => store.upsertTask);

  const createProgressChannel = (transferId: string) => {
    const channel = new Channel<TransferProgress>();
    channel.onmessage = (progress) => {
      if (progress.transferId !== transferId) return;
      applyTransferProgress(progress);
    };
    return channel;
  };

  const loadDirectory = useCallback(
    async (path?: string) => {
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
        setState({
          status: "ready",
          path: result.path,
          entries: result.entries,
          fallbackToRoot: result.fallbackToRoot
        });
      } catch (error) {
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

  const handleCopyPath = async (entry: RemoteFileEntry) => {
    setContextMenu(null);

    try {
      await navigator.clipboard.writeText(entry.path);
      setNotice("已复制路径");
    } catch (error) {
      console.error("[wmcssh][file-transfer] copy path failed", error);
      setNotice("复制路径失败");
    }
  };

  const handleTrustHostKey = async (error: AppErrorDto) => {
    try {
      const trusted = await confirmAndTrustHostKey(hostId, error);
      if (trusted) await loadDirectory();
    } catch (cause) {
      setState({ status: "error", error: normalizeAppError(cause) });
    }
  };

  const renderRow = (entry: RemoteFileEntry) => {
    const isDirectory = entry.entryType === "directory";

    return (
      <button
        key={entry.path}
        type="button"
        className="file-transfer-entry"
        onClick={() => {
          if (!isDirectory) return;
          void loadDirectory(entry.path);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setContextMenu({
            entry,
            x: event.clientX,
            y: event.clientY
          });
        }}
      >
        <span className={`file-transfer-entry-icon ${entry.entryType}`}>{isDirectory ? "DIR" : "FILE"}</span>
        <span className="file-transfer-entry-name">{entry.name}</span>
        <span className="file-transfer-entry-meta">
          {entry.entryType === "directory" ? "目录" : entry.size ? `${entry.size} B` : "文件"}
        </span>
      </button>
    );
  };

  return (
    <div className="file-transfer-view">
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
            void loadDirectory(state.status === "ready" ? state.path : undefined);
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
          onClick={() => setQueueVisible((visible) => !visible)}
          aria-expanded={queueVisible}
          aria-controls={`transfer-queue-${tabId}`}
        >
          传输队列
        </button>
        <div className="file-transfer-path">
          {state.status === "ready" ? state.path : "正在连接远程目录..."}
        </div>
      </div>

      {queueVisible ? (
        <div id={`transfer-queue-${tabId}`} className="file-transfer-queue-panel">
          <TransferQueue transferSessionId={transferSessionId} compact />
        </div>
      ) : null}

      {notice ? <div className="file-transfer-note">{notice}</div> : null}

      {state.status === "loading" ? <div className="file-transfer-message">正在加载远程目录...</div> : null}

      {state.status === "error" ? (
        <div className="file-transfer-message file-transfer-error">
          <div>目录加载失败：{state.error.message}</div>
          {(state.error.code === "host_key_unknown" || state.error.code === "host_key_mismatch") ? (
            <button type="button" className="ghost-button" onClick={() => void handleTrustHostKey(state.error)}>
              {state.error.code === "host_key_mismatch" ? "核对并更新密钥" : "核对并信任"}
            </button>
          ) : null}
          {state.error.code !== "host_key_unknown" && state.error.code !== "host_key_mismatch" ? (
            <button type="button" className="ghost-button" onClick={() => void loadDirectory()}>
              重试
            </button>
          ) : null}
        </div>
      ) : null}

      {state.status === "ready" ? (
        <>
          {state.fallbackToRoot ? (
            <div className="file-transfer-note">未获取到用户家目录，已自动回退到根目录 `/`。</div>
          ) : null}
          <div className="file-transfer-list-scroll-area">
            <div ref={listRef} className="file-transfer-list">
              {state.entries.length > 0 ? state.entries.map(renderRow) : (
                <div className="file-transfer-message">当前目录为空。</div>
              )}
            </div>
            <CustomScrollbar scrollRef={listRef} />
          </div>
        </>
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
            disabled={busy}
            onClick={() => void handleDownload(contextMenu.entry)}
          >
            下载
          </button>
          <button
            type="button"
            onClick={() => void handleCopyPath(contextMenu.entry)}
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
