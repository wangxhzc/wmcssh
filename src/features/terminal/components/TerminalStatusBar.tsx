import { useTerminalStore } from "../../../stores/terminalStore";
import { sessionStatusLabel } from "../sessionStatusLabel";

export function TerminalStatusBar() {
  const tabs = useTerminalStore((state) => state.tabs);
  const activeTabId = useTerminalStore((state) => state.activeTabId);
  const activeTab = tabs.find((tab) => tab.tabId === activeTabId);

  return (
    <div className="terminal-status-bar">
      {activeTab
        ? activeTab.kind === "terminal"
          ? `${activeTab.title} · ${sessionStatusLabel[activeTab.status]}`
          : `${activeTab.title} · 文件传输`
        : "尚未打开会话 · 从主机列表连接，或使用顶部快速连接"}
    </div>
  );
}
