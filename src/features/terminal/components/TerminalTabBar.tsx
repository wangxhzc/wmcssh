import { TerminalTabTitle } from "./TerminalTabTitle";
import { useEffect, useMemo, useRef, useState } from "react";
import { useHostStore } from "../../../stores/hostStore";
import { openFileTransferTab } from "../../file-transfer/actions";
import { connectHost, closeWorkspaceTab } from "../actions";
import { useTerminalStore } from "../../../stores/terminalStore";
import { useAnchoredMenuPosition } from "../../../app/useAnchoredMenuPosition";
import { sessionStatusLabel } from "../sessionStatusLabel";
import type { SessionStatus } from "../../../types/ssh";

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
  const [tabListOpen, setTabListOpen] = useState(false);
  const [tabsOverflow, setTabsOverflow] = useState(false);
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  const tabListButtonRef = useRef<HTMLButtonElement | null>(null);
  const tabListMenuRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const tabMenuPosition = useAnchoredMenuPosition(tabMenu, menuRef);
  const tabListAnchor = useMemo(() => {
    if (!tabListOpen || !tabListButtonRef.current) return null;
    const rect = tabListButtonRef.current.getBoundingClientRect();
    return { x: rect.right - 220, y: rect.bottom };
  }, [tabListOpen]);
  const tabListPosition = useAnchoredMenuPosition(tabListAnchor, tabListMenuRef);

  const closeTabMenu = () => setTabMenu(null);

  useEffect(() => {
    const closeShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.key.toLowerCase() !== "w") return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const id = useTerminalStore.getState().activeTabId;
      if (!id) return;
      event.preventDefault(); event.stopImmediatePropagation();
      void closeWorkspaceTab(id);
    };
    window.addEventListener("keydown", closeShortcut, true);
    return () => window.removeEventListener("keydown", closeShortcut, true);
  }, []);

  useEffect(() => {
    const strip = tabStripRef.current;
    if (!strip) return;

    const updateOverflow = () => {
      setTabsOverflow(strip.scrollWidth > strip.clientWidth + 1);
    };
    updateOverflow();
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(strip);
    for (const child of strip.children) observer.observe(child);
    return () => observer.disconnect();
  }, [tabs]);

  useEffect(() => {
    if (!tabsOverflow) setTabListOpen(false);
  }, [tabsOverflow]);

  useEffect(() => {
    if (!activeTabId) return;
    requestAnimationFrame(() => {
      tabStripRef.current
        ?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeTabId)}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }, [activeTabId]);

  useEffect(() => {
    if (!tabMenu && !tabListOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current?.contains(target)) return;
      if (tabListMenuRef.current?.contains(target) || tabListButtonRef.current?.contains(target)) return;
      closeTabMenu();
      setTabListOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeTabMenu();
        setTabListOpen(false);
      }
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [tabListOpen, tabMenu]);

  const activateTab = (tabId: string) => {
    setActiveTab(tabId);
    requestAnimationFrame(() => {
      tabStripRef.current
        ?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(tabId)}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  };

  const renderStatus = (status: SessionStatus | "created") => {
    return <span className={`tab-status-dot ${status}`} aria-label={sessionStatusLabel[status]} title={sessionStatusLabel[status]} />;
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
      <div ref={tabStripRef} className="tab-strip">
        {tabs.map((tab) => (
          <div
            key={tab.tabId}
            data-tab-id={tab.tabId}
            className={tab.tabId === activeTabId ? "tab-item active" : "tab-item"}
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
            title={tab.kind === "terminal" ? tab.errorMessage ?? `${tab.title}${tab.remoteTitle ? ` · ${tab.remoteTitle}` : ""} ${sessionStatusLabel[tab.status]}${tab.currentDirectory ? `\n${tab.currentDirectory}` : ""}` : tab.title}
          >
            <button type="button" className="tab-activate" aria-pressed={tab.tabId === activeTabId} onClick={() => activateTab(tab.tabId)}>
              <TerminalTabTitle title={tab.kind === "terminal" && tab.remoteTitle ? `${tab.title} · ${tab.remoteTitle}` : tab.title} active={tab.tabId === activeTabId} />{tab.kind === "terminal" ? renderStatus(tab.status) : null}
            </button>
            <button
              type="button"
              className="tab-close"
              aria-label={`关闭 ${tab.title}`}
              title="关闭标签（Ctrl/Cmd+Shift+W）"
              onClick={(event) => {
                event.stopPropagation();
                void closeWorkspaceTab(tab.tabId);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        ref={tabListButtonRef}
        type="button"
        className={`tab-list-button${tabsOverflow ? " visible" : ""}`}
        aria-label="显示所有标签"
        title="显示所有标签"
        aria-expanded={tabListOpen}
        onClick={() => {
          closeTabMenu();
          setTabListOpen((open) => !open);
        }}
      >
        ▾
      </button>
      {tabListOpen ? (
        <div
          ref={tabListMenuRef}
          className="app-context-menu tab-list-menu"
          style={{ left: tabListPosition?.x ?? tabListAnchor?.x, top: tabListPosition?.y ?? tabListAnchor?.y }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.tabId}
              type="button"
              className={tab.tabId === activeTabId ? "active" : ""}
              onClick={() => {
                setTabListOpen(false);
                activateTab(tab.tabId);
              }}
            >
              <span className="tab-list-title">{tab.kind === "terminal" && tab.remoteTitle ? `${tab.title} · ${tab.remoteTitle}` : tab.title}</span>
              <span className="tab-list-kind">{tab.kind === "terminal" ? sessionStatusLabel[tab.status] : "文件"}</span>
            </button>
          ))}
        </div>
      ) : null}
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
              openFileTransferTab(menuHost, tabMenu.tabId);
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
