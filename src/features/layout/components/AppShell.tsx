import { useState } from "react";
import { HostSidebar } from "../../hosts/components/HostSidebar";
import { TerminalWorkspace } from "../../terminal/components/TerminalWorkspace";

export function AppShell() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className={`app-shell${sidebarCollapsed ? " app-shell-collapsed" : ""}`}>
      {!sidebarCollapsed ? (
        <HostSidebar onCollapse={() => setSidebarCollapsed(true)} />
      ) : null}
      <main className="main-panel">
        {sidebarCollapsed ? (
          <button
            type="button"
            className="sidebar-toggle-button sidebar-toggle-boundary sidebar-toggle-expand"
            onClick={() => setSidebarCollapsed(false)}
            title="展开侧边栏"
            aria-label="展开侧边栏"
          >
            <span className="sidebar-arrow-desktop">▶</span>
            <span className="sidebar-arrow-mobile">▼</span>
          </button>
        ) : null}
        <TerminalWorkspace />
      </main>
    </div>
  );
}
