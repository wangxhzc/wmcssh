import { FileTransferView } from "../../file-transfer/components/FileTransferView";
import { useTerminalStore } from "../../../stores/terminalStore";
import { TerminalView } from "./TerminalView";

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
            <TerminalView tabId={tab.tabId} sessionId={tab.sessionId} active={tab.tabId === activeTabId} />
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
