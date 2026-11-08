import { useEffect } from "react";
import { useTerminalNoticeStore } from "../../../stores/terminalNoticeStore";
import { useTerminalStore } from "../../../stores/terminalStore";
import { focusTerminal } from "../terminalFocus";

export function TerminalNotifications() {
  const notices = useTerminalNoticeStore((state) => state.notices);
  const dismiss = useTerminalNoticeStore((state) => state.dismiss);
  useEffect(() => {
    const timers = notices.map((notice) => window.setTimeout(() => dismiss(notice.id), Math.max(0, notice.expiresAt - Date.now())));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [notices, dismiss]);
  return <div className="terminal-notifications" aria-live="polite">
    {notices.map((notice) => <div className="terminal-notification" key={notice.id}>
      <button className="terminal-notification-content" onClick={() => {
        const store = useTerminalStore.getState();
        if (store.tabs.some((tab) => tab.tabId === notice.tabId)) store.setActiveTab(notice.tabId);
        focusTerminal(notice.tabId);
        dismiss(notice.id);
      }}>
        <span className="terminal-notification-source">{notice.source}</span>
        <strong>{notice.title}</strong>
        {notice.body ? <span>{notice.body}</span> : null}
      </button>
      <button className="terminal-notification-close" aria-label="关闭通知" title="关闭通知" onClick={() => dismiss(notice.id)}>×</button>
    </div>)}
  </div>;
}
