import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { getAppInfo } from "../../../services/tauri/settingsApi";
import { QuickConnectDialog } from "../../hosts/components/QuickConnectDialog";
import { parseQuickConnectCommand, type QuickConnectTarget } from "../../hosts/quickConnect";

type AppTitleBarProps = {
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
};

const appWindow = getCurrentWindow();

export function AppTitleBar({ sidebarVisible, onToggleSidebar }: AppTitleBarProps) {
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
