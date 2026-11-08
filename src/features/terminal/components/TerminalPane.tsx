import { FileTransferView } from "../../file-transfer/components/FileTransferView";
import { useTerminalStore } from "../../../stores/terminalStore";
import { TerminalView } from "./TerminalView";
import { reconnectTab, trustHostKeyAndReconnect } from "../actions";
import { focusTerminal } from "../terminalFocus";

const RETRYABLE_ERRORS = new Set(["network_unreachable", "timeout", "session_closed", "session_not_found", "io_error", "unknown"]);

export function TerminalPane() {
  const tabs = useTerminalStore((state) => state.tabs);
  const activeTabId = useTerminalStore((state) => state.activeTabId);

  return (
    <div className="terminal-pane">
      {tabs.map((tab) => (
        <div
          key={tab.tabId}
          style={{
            position: "absolute",
            inset: 0,
            display: tab.tabId === activeTabId ? "block" : "none"
          }}
        >
          {tab.kind === "terminal" ? (
            <>
              <TerminalView tabId={tab.tabId} sessionId={tab.sessionId} active={tab.tabId === activeTabId} />
              {tab.errorMessage && (tab.errorCode || tab.status === "error" || tab.status === "disconnected") ? <div className={`terminal-status-banner ${tab.status === "error" ? "error" : ""}`}>
                <span>{tab.errorMessage}</span>
                {(tab.errorCode === "host_key_unknown" || tab.errorCode === "host_key_mismatch") ? <button type="button" className="ghost-button" onClick={() => { focusTerminal(tab.tabId); void trustHostKeyAndReconnect(tab.tabId); }}>{tab.errorCode === "host_key_mismatch" ? "核对并更新密钥" : "核对并信任"}</button> : null}
                {(tab.status === "disconnected" || (tab.errorCode && RETRYABLE_ERRORS.has(tab.errorCode))) ? <button type="button" className="ghost-button" onClick={() => { focusTerminal(tab.tabId); void reconnectTab(tab.tabId); }}>重新连接</button> : null}
              </div> : null}
            </>
          ) : (
            <FileTransferView
              tabId={tab.tabId}
              hostId={tab.hostId}
              transferSessionId={tab.transferSessionId}
              active={tab.tabId === activeTabId}
            />
          )}
        </div>
      ))}
    </div>
  );
}
