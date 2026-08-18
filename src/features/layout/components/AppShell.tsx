import { useState } from "react";
import { HostSidebar } from "../../hosts/components/HostSidebar";
import { TerminalWorkspace } from "../../terminal/components/TerminalWorkspace";
import { AppTitleBar } from "./AppTitleBar";

export function AppShell() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="app-frame">
      <AppTitleBar
        sidebarVisible={!sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)}
      />
      <div className={`app-shell${sidebarCollapsed ? " app-shell-collapsed" : ""}`}>
        {!sidebarCollapsed ? <HostSidebar /> : null}
        <main className="main-panel">
          <TerminalWorkspace />
        </main>
      </div>
    </div>
  );
}
