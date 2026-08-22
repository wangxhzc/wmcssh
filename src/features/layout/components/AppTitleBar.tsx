import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { getAppInfo } from "../../../services/tauri/settingsApi";
import { QuickConnectDialog } from "../../hosts/components/QuickConnectDialog";
import { parseQuickConnectCommand, type QuickConnectTarget } from "../../hosts/quickConnect";

type AppTitleBarProps = {
  sidebarVisible: boolean;
  settingsOpen: boolean;
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
};

const appWindow = getCurrentWindow();

export function AppTitleBar({
  sidebarVisible,
  settingsOpen,
  onToggleSidebar,
  onOpenSettings
}: AppTitleBarProps) {
  const [command, setCommand] = useState("");
  const [commandError, setCommandError] = useState<string>();
  const [quickConnectTarget, setQuickConnectTarget] = useState<QuickConnectTarget | null>(null);
  const [currentUsername, setCurrentUsername] = useState("");

  useEffect(() => {
    void getAppInfo().then((info) => setCurrentUsername(info.currentUsername)).catch(() => undefined);
  }, []);

  const submitQuickConnect = () => {
    try {
      const target = parseQuickConnectCommand(command);
      setCommandError(undefined);
      setQuickConnectTarget(target);
    } catch (cause) {
      setCommandError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <header className="app-titlebar" data-tauri-drag-region>
      <button
        type="button"
        className={`titlebar-button titlebar-sidebar-button${sidebarVisible ? " active" : ""}`}
        onClick={onToggleSidebar}
        title={sidebarVisible ? "隐藏侧边栏" : "显示侧边栏"}
        aria-label={sidebarVisible ? "隐藏侧边栏" : "显示侧边栏"}
      >
        <span className="hamburger-icon" aria-hidden="true" />
      </button>

      <form
        className={`titlebar-command${commandError ? " invalid" : ""}`}
        onSubmit={(event) => {
          event.preventDefault();
          submitQuickConnect();
        }}
      >
        <span className="titlebar-product">快速连接</span>
        <span className="titlebar-separator">›</span>
        <input
          value={command}
          onChange={(event) => {
            setCommand(event.target.value);
            setCommandError(undefined);
          }}
          placeholder="ssh 10.0.0.1 或 ssh root@10.0.0.1"
          aria-label="快速连接命令"
          title={commandError}
        />
      </form>

      <div className="titlebar-window-controls">
        <button
          type="button"
          className={`titlebar-button titlebar-settings-button${settingsOpen ? " active" : ""}`}
          onClick={onOpenSettings}
          title={settingsOpen ? "关闭设置" : "打开设置"}
          aria-label={settingsOpen ? "关闭设置" : "打开设置"}
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9.7 2.8h4.6l.5 2a8 8 0 0 1 1.4.8l2-.6 2.3 4-1.5 1.4a8 8 0 0 1 0 1.6l1.5 1.4-2.3 4-2-.6a8 8 0 0 1-1.4.8l-.5 2H9.7l-.5-2a8 8 0 0 1-1.4-.8l-2 .6-2.3-4L5 12a8 8 0 0 1 0-1.6L3.5 9l2.3-4 2 .6a8 8 0 0 1 1.4-.8l.5-2Z" />
            <circle cx="12" cy="11.2" r="3" />
          </svg>
        </button>
        <button
          type="button"
          className="titlebar-button"
          onClick={() => void appWindow.minimize()}
          title="最小化"
          aria-label="最小化"
        >
          —
        </button>
        <button
          type="button"
          className="titlebar-button"
          onClick={() => void appWindow.toggleMaximize()}
          title="最大化/还原"
          aria-label="最大化或还原"
        >
          □
        </button>
        <button
          type="button"
          className="titlebar-button titlebar-close-button"
          onClick={() => void appWindow.close()}
          title="关闭"
          aria-label="关闭"
        >
          ×
        </button>
      </div>
      <QuickConnectDialog
        target={quickConnectTarget}
        currentUsername={currentUsername}
        onClose={() => {
          setQuickConnectTarget(null);
          setCommand("");
        }}
      />
    </header>
  );
}
