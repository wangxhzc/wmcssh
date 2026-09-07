import { type CSSProperties, useEffect, useRef, useState } from "react";
import { HostSidebar } from "../../hosts/components/HostSidebar";
import { TerminalWorkspace } from "../../terminal/components/TerminalWorkspace";
import { SettingsDialog } from "../../settings/components/SettingsDialog";
import { AppTitleBar } from "./AppTitleBar";

export function AppShell() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.matchMedia("(max-width: 900px)").matches);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [sidebarMaxWidth, setSidebarMaxWidth] = useState(480);
  const [resizing, setResizing] = useState(false);
  const sidebarMinWidth = 200;
  const resizeSidebar = (width: number) => setSidebarWidth(Math.round(Math.max(sidebarMinWidth, Math.min(sidebarMaxWidth, width))));
  const stopResizing = () => {
    dragRef.current = null;
    setResizing(false);
  };

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const observer = new ResizeObserver(() => {
      const maximum = Math.max(sidebarMinWidth, Math.min(480, Math.floor(shell.clientWidth / 2)));
      setSidebarMaxWidth(maximum);
      setSidebarWidth((width) => Math.min(width, maximum));
    });
    observer.observe(shell);
    window.addEventListener("blur", stopResizing);
    return () => {
      observer.disconnect();
      window.removeEventListener("blur", stopResizing);
    };
  }, []);

  return (
    <div className="app-frame">
      <AppTitleBar
        sidebarVisible={!sidebarCollapsed}
        settingsOpen={settingsOpen}
        onToggleSidebar={() => { stopResizing(); setSidebarCollapsed((collapsed) => !collapsed); }}
        onOpenSettings={() => setSettingsOpen((open) => !open)}
      />
      <div
        ref={shellRef}
        className={`app-shell${sidebarCollapsed ? " app-shell-collapsed" : ""}${resizing ? " sidebar-resizing" : ""}`}
        style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
      >
        {!sidebarCollapsed ? <button className="sidebar-backdrop" aria-label="收起主机列表" onClick={() => setSidebarCollapsed(true)} /> : null}
        {!sidebarCollapsed ? <HostSidebar /> : null}
        {!sidebarCollapsed ? (
          <div
            className="sidebar-resize-handle"
            role="separator"
            aria-label="调整主机侧边栏宽度"
            aria-orientation="vertical"
            aria-valuemin={sidebarMinWidth}
            aria-valuemax={sidebarMaxWidth}
            aria-valuenow={sidebarWidth}
            tabIndex={0}
            title="拖动调整宽度，双击恢复默认"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
              dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: sidebarWidth };
              setResizing(true);
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current;
              if (!drag || drag.pointerId !== event.pointerId) return;
              resizeSidebar(drag.startWidth + event.clientX - drag.startX);
            }}
            onPointerUp={(event) => {
              stopResizing();
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={stopResizing}
            onLostPointerCapture={stopResizing}
            onDoubleClick={() => resizeSidebar(240)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") resizeSidebar(sidebarWidth - 10);
              else if (event.key === "ArrowRight") resizeSidebar(sidebarWidth + 10);
              else if (event.key === "Home") resizeSidebar(sidebarMinWidth);
              else if (event.key === "End") resizeSidebar(sidebarMaxWidth);
              else return;
              event.preventDefault();
            }}
          />
        ) : null}
        <main className="main-panel">
          <TerminalWorkspace />
        </main>
      </div>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
