import { useTerminalStore } from "../../../stores/terminalStore";

export function TerminalStatusBar() {
  const tabs = useTerminalStore((state) => state.tabs);
  const activeTabId = useTerminalStore((state) => state.activeTabId);
  const activeTab = tabs.find((tab) => tab.tabId === activeTabId);

  return (
    <div className="terminal-status-bar">
      {activeTab
        ? activeTab.kind === "terminal"
          ? `${activeTab.title} · ${activeTab.status}`
          : `${activeTab.title} · 文件传输`
        : "No active tab"}
    </div>
  );
}
