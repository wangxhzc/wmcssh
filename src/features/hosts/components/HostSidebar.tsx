import { useEffect, useRef, useState } from "react";
import { useHostStore } from "../../../stores/hostStore";
import { deleteHost, duplicateHost } from "../../../services/tauri/hostApi";
import { connectHost } from "../../terminal/actions";
import { openFileTransferTab } from "../../file-transfer/actions";
import { HostFormDialog } from "./HostFormDialog";
import type { HostDto } from "../../../types/host";
import { useAnchoredMenuPosition } from "../../../app/useAnchoredMenuPosition";

type HostMenuState = {
  host: HostDto;
  x: number;
  y: number;
} | null;

const STATUS_MESSAGE_DURATION_MS = 3500;

export function HostSidebar() {
  const hosts = useHostStore((state) => state.hosts);
  const loading = useHostStore((state) => state.loading);
  const keyword = useHostStore((state) => state.keyword);
  const setKeyword = useHostStore((state) => state.setKeyword);
  const loadHosts = useHostStore((state) => state.loadHosts);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingHost, setEditingHost] = useState<HostDto | null>(null);
  const [busyHostId, setBusyHostId] = useState<string>();
  const [statusMessage, setStatusMessage] = useState<string>();
  const [hostMenu, setHostMenu] = useState<HostMenuState>(null);
  const hostMenuRef = useRef<HTMLDivElement | null>(null);
  const statusTimerRef = useRef<number | undefined>(undefined);
  const searchInitializedRef = useRef(false);
  const hostMenuPosition = useAnchoredMenuPosition(hostMenu, hostMenuRef);

  useEffect(() => {
    return () => {
      if (statusTimerRef.current !== undefined) {
        window.clearTimeout(statusTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!searchInitializedRef.current) {
      searchInitializedRef.current = true;
      return;
    }
    const timer = window.setTimeout(() => {
      void loadHosts().catch((error) => {
        showStatusMessage(`搜索失败：${error instanceof Error ? error.message : String(error)}`);
      });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [keyword, loadHosts]);

  useEffect(() => {
    if (!hostMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (hostMenuRef.current?.contains(event.target as Node | null)) return;
      setHostMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHostMenu(null);
    };
    const handleWindowBlur = () => setHostMenu(null);

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [hostMenu]);

  const clearStatusMessage = () => {
    if (statusTimerRef.current !== undefined) {
      window.clearTimeout(statusTimerRef.current);
      statusTimerRef.current = undefined;
    }
    setStatusMessage(undefined);
  };

  const showStatusMessage = (message: string) => {
    if (statusTimerRef.current !== undefined) {
      window.clearTimeout(statusTimerRef.current);
    }
    setStatusMessage(message);
    statusTimerRef.current = window.setTimeout(() => {
      setStatusMessage(undefined);
      statusTimerRef.current = undefined;
    }, STATUS_MESSAGE_DURATION_MS);
  };

  const closeHostMenu = () => setHostMenu(null);

  const openCreateDialog = () => {
    setEditingHost(null);
    setCreateDialogOpen(true);
  };

  const openEditDialog = (host: HostDto) => {
    setCreateDialogOpen(true);
    setEditingHost(host);
  };

  const closeFormDialog = () => {
    setCreateDialogOpen(false);
    setEditingHost(null);
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showStatusMessage("已复制到剪贴板");
    } catch (error) {
      showStatusMessage(`复制失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const createCopyHostName = (sourceName: string) => {
    const trimmedName = sourceName.trim();
    const copyPrefix = `${trimmedName} copy`;
    const existingNames = new Set(hosts.map((host) => host.name));

    if (!existingNames.has(copyPrefix)) {
      return copyPrefix;
    }

    let index = 1;
    while (existingNames.has(`${copyPrefix}-${index}`)) {
      index += 1;
    }
    return `${copyPrefix}-${index}`;
  };

  return (
    <aside className="sidebar" onClick={closeHostMenu} onContextMenu={closeHostMenu}>
      <div className="sidebar-heading">
        <span>主机</span>
        <span className="sidebar-count">{hosts.length}</span>
      </div>
      <div className="sidebar-actions">
        <div className="sidebar-host-controls">
          <input
            className="search-input"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void loadHosts();
            }}
            placeholder="搜索主机"
          />
          <button
            className="sidebar-add-button"
            onClick={openCreateDialog}
            title="新建主机"
            aria-label="新建主机"
          >
            +
          </button>
        </div>
      </div>

      {statusMessage ? <div className="sidebar-note" role="status">{statusMessage}</div> : null}

      {loading ? <p>加载中...</p> : null}

      {!loading && hosts.length === 0 ? <p className="empty-state">还没有主机，先新建一个。</p> : null}

      {hosts.map((host) => (
        <div
          key={host.id}
          className="host-card"
          role="button"
          tabIndex={0}
          onClick={() => void connectHost(host)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              void connectHost(host);
            }
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setHostMenu({
              host,
              x: event.clientX,
              y: event.clientY
            });
          }}
        >
          <div className="host-card-main">
            <div className="host-name">{host.name}</div>
            <div className="host-meta">
              {host.username}@{host.hostname}:{host.port}
            </div>
          </div>

        </div>
      ))}

      <HostFormDialog open={createDialogOpen} host={editingHost} onClose={closeFormDialog} />

      {hostMenu ? (
        <div
          ref={hostMenuRef}
          className="app-context-menu"
          style={{ left: hostMenuPosition?.x ?? hostMenu.x, top: hostMenuPosition?.y ?? hostMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <button
            type="button"
            onClick={() => {
              closeHostMenu();
              void connectHost(hostMenu.host);
            }}
          >
            连接
          </button>
          <button
            type="button"
            onClick={() => {
              closeHostMenu();
              openFileTransferTab(hostMenu.host);
            }}
          >
            文件传输
          </button>
          <button
            type="button"
            onClick={() => {
              closeHostMenu();
              openEditDialog(hostMenu.host);
            }}
          >
            编辑
          </button>
          <button
            type="button"
            onClick={() => {
              closeHostMenu();
              void copyText(`${hostMenu.host.username}@${hostMenu.host.hostname}:${hostMenu.host.port}`);
            }}
          >
            复制地址
          </button>
          <button
            type="button"
            disabled={busyHostId === hostMenu.host.id}
            onClick={async () => {
              closeHostMenu();
              setBusyHostId(hostMenu.host.id);
              clearStatusMessage();
              try {
                const copiedName = createCopyHostName(hostMenu.host.name);
                await duplicateHost({
                  hostId: hostMenu.host.id,
                  name: copiedName
                });
                await loadHosts();
                showStatusMessage(`已复制主机为「${copiedName}」`);
              } catch (error) {
                showStatusMessage(`复制失败：${error instanceof Error ? error.message : String(error)}`);
              } finally {
                setBusyHostId(undefined);
              }
            }}
          >
            复制
          </button>
          <button
            type="button"
            className="menu-danger"
            disabled={busyHostId === hostMenu.host.id}
            onClick={async () => {
              closeHostMenu();
              if (!window.confirm(`删除主机「${hostMenu.host.name}」？`)) return;

              setBusyHostId(hostMenu.host.id);
              clearStatusMessage();
              try {
                await deleteHost(hostMenu.host.id);
                await loadHosts();
                showStatusMessage(`已删除主机「${hostMenu.host.name}」`);
              } catch (error) {
                showStatusMessage(`删除失败：${error instanceof Error ? error.message : String(error)}`);
              } finally {
                setBusyHostId(undefined);
              }
            }}
          >
            删除
          </button>
        </div>
      ) : null}
    </aside>
  );
}
