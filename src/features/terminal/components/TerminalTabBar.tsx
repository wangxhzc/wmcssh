import { TerminalTabTitle } from "./TerminalTabTitle";
import { useEffect, useMemo, useRef, useState } from "react";
import { getHost } from "../../../services/tauri/hostApi";
import type { HostDto } from "../../../types/host";
import { openFileTransferTab } from "../../file-transfer/actions";
import { connectHost, closeWorkspaceTab } from "../actions";
import { useTerminalStore } from "../../../stores/terminalStore";
import { useAnchoredMenuPosition } from "../../../app/useAnchoredMenuPosition";
import { sessionStatusLabel } from "../sessionStatusLabel";
import type { SessionStatus } from "../../../types/ssh";
import { useTabReorder } from "../useTabReorder";
import { focusTerminal } from "../terminalFocus";

type TabMenuState = {
  tabId: string;
  x: number;
  y: number;
} | null;

export function TerminalTabBar() {
  const tabs = useTerminalStore((state) => state.tabs);
  const activeTabId = useTerminalStore((state) => state.activeTabId);
  const setActiveTab = useTerminalStore((state) => state.setActiveTab);
  const [menuHost, setMenuHost] = useState<HostDto>();
  const [menuHostError, setMenuHostError] = useState<string>();
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
  const reorder = useTabReorder(tabStripRef, (tabId, targetTabId, after) => {
    useTerminalStore.getState().moveTab(tabId, targetTabId, after);
  });

  const closeTabMenu = () => setTabMenu(null);

  useEffect(() => {
    if (!tabMenu) return;
    const tab = useTerminalStore.getState().tabs.find((item) => item.tabId === tabMenu.tabId);
    if (!tab) return;
    let cancelled = false;
    void getHost(tab.hostId).then((host) => {
      if (!cancelled) setMenuHost(host);
    }).catch((error) => {
      if (!cancelled) setMenuHostError(`读取主机失败：${error instanceof Error ? error.message : String(error)}`);
    });
    return () => { cancelled = true; };
  }, [tabMenu]);

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
        if (activeTabId) focusTerminal(activeTabId);
      }
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    const onBlur = () => { closeTabMenu(); setTabListOpen(false); };
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [tabListOpen, tabMenu, activeTabId]);

  const activateTab = (tabId: string) => {
    setActiveTab(tabId);
    focusTerminal(tabId);
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
    <div className={`tab-bar${reorder.draggedId ? " tab-reordering" : ""}`}>
      <div ref={tabStripRef} className="tab-strip">
        {tabs.map((tab) => (
          <div
            key={tab.tabId}
            data-tab-id={tab.tabId}
            className={`tab-item${tab.tabId === activeTabId ? " active" : ""}${reorder.draggedId === tab.tabId ? " dragging" : ""}${reorder.destination?.targetTabId === tab.tabId ? (reorder.destination.after ? " drop-after" : " drop-before") : ""}`}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              closeTabMenu();
              setTabListOpen(false);
              reorder.start(event, tab.tabId);
            }}
            onDragStart={(event) => event.preventDefault()}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setActiveTab(tab.tabId);
              setMenuHost(undefined);
              setMenuHostError(undefined);
              setTabMenu({
                tabId: tab.tabId,
                x: event.clientX,
                y: event.clientY
              });
            }}
            title={tab.kind === "terminal" ? tab.errorMessage ?? `${tab.title}${tab.remoteTitle ? ` · ${tab.remoteTitle}` : ""} ${sessionStatusLabel[tab.status]}${tab.currentDirectory ? `\n${tab.currentDirectory}` : ""}` : tab.title}
          >
            <button type="button" className="tab-activate" aria-pressed={tab.tabId === activeTabId} onClick={() => { if (!reorder.suppressClick()) activateTab(tab.tabId); }}>
              <TerminalTabTitle title={tab.title} active={tab.tabId === activeTabId} />{tab.kind === "terminal" ? renderStatus(tab.status) : null}
            </button>
            <button
              type="button"
              className="tab-close"
              aria-label={`关闭 ${tab.title}`}
              title="关闭标签（Ctrl/Cmd+Shift+W）"
              onClick={(event) => {
                event.stopPropagation();
                if (reorder.suppressClick()) return;
                if (activeTabId && activeTabId !== tab.tabId) focusTerminal(activeTabId);
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
              <span className="tab-list-title">{tab.title}</span>
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
          {menuHostError ? <p role="alert">{menuHostError}</p> : null}
          <button
            type="button"
            disabled={!menuHost}
            onClick={async () => {
              closeTabMenu();
              if (!menuHost) return;
              await connectHost(menuHost, undefined, tabMenu.tabId);
            }}
          >
            复制连接
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
              focusTerminal(menuTab.tabId);
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
