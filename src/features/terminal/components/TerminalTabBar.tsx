import { useEffect, useRef, useState } from "react";
import { useHostStore } from "../../../stores/hostStore";
import { openFileTransferTab } from "../../file-transfer/actions";
import { connectHost, closeWorkspaceTab } from "../actions";
import { useTerminalStore } from "../../../stores/terminalStore";
import { useAnchoredMenuPosition } from "../../../app/useAnchoredMenuPosition";

type TabMenuState = {
  tabId: string;
  x: number;
  y: number;
} | null;

export function TerminalTabBar() {
  const tabs = useTerminalStore((state) => state.tabs);
  const activeTabId = useTerminalStore((state) => state.activeTabId);
  const setActiveTab = useTerminalStore((state) => state.setActiveTab);
  const hosts = useHostStore((state) => state.hosts);
  const [tabMenu, setTabMenu] = useState<TabMenuState>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const tabMenuPosition = useAnchoredMenuPosition(tabMenu, menuRef);

  const closeTabMenu = () => setTabMenu(null);

  useEffect(() => {
    if (!tabMenu) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current?.contains(target)) return;
      closeTabMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeTabMenu();
      }
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [tabMenu]);

  const renderStatus = (status: string) => {
    return <span className={`tab-status-dot ${status}`} aria-label={status} title={status} />;
  };

  const menuTab = tabMenu ? tabs.find((tab) => tab.tabId === tabMenu.tabId) : undefined;
  const menuHost = menuTab ? hosts.find((host) => host.id === menuTab.hostId) : undefined;

  const closeOtherTabs = async (tabId: string) => {
    const closingTabs = useTerminalStore
      .getState()
      .tabs.filter((item) => item.tabId !== tabId)
      .map((item) => item.tabId);
    for (const closingTabId of closingTabs) {
      await closeWorkspaceTab(closingTabId);
    }
  };

  const closeAllTabs = async () => {
    const closingTabs = useTerminalStore.getState().tabs.map((item) => item.tabId);
    for (const closingTabId of closingTabs) {
      await closeWorkspaceTab(closingTabId);
    }
  };

  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <button
          key={tab.tabId}
          className={tab.tabId === activeTabId ? "tab-item active" : "tab-item"}
          onClick={() => setActiveTab(tab.tabId)}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setActiveTab(tab.tabId);
            setTabMenu({
              tabId: tab.tabId,
              x: event.clientX,
              y: event.clientY
            });
          }}
          title={tab.kind === "terminal" ? tab.errorMessage ?? `${tab.title} ${tab.status}` : tab.title}
        >
          <span>{tab.title}</span>
          {tab.kind === "terminal" ? renderStatus(tab.status) : null}
          <span
            className="tab-close"
            onClick={(event) => {
              event.stopPropagation();
              void closeWorkspaceTab(tab.tabId);
            }}
          >
            ×
          </span>
        </button>
      ))}
      {tabMenu ? (
        <div
          ref={menuRef}
          className="app-context-menu"
          style={{ left: tabMenuPosition?.x ?? tabMenu.x, top: tabMenuPosition?.y ?? tabMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <button
            type="button"
            disabled={!menuHost}
            onClick={async () => {
              closeTabMenu();
              if (!menuHost) return;
              await connectHost(menuHost);
            }}
          >
            复制
          </button>
          <button
            type="button"
            disabled={!menuHost}
            onClick={() => {
              closeTabMenu();
              if (!menuHost) return;
              openFileTransferTab(menuHost);
            }}
          >
            文件传输
          </button>
          <button
            type="button"
            disabled={!menuTab}
            onClick={async () => {
              if (!menuTab) return;
              closeTabMenu();
              await closeOtherTabs(menuTab.tabId);
            }}
          >
            关闭其他
          </button>
          <button
            type="button"
            disabled={tabs.length === 0}
            onClick={async () => {
              closeTabMenu();
              await closeAllTabs();
            }}
          >
            关闭全部
          </button>
        </div>
      ) : null}
    </div>
  );
}
