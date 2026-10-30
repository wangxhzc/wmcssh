import { TerminalPane } from "./TerminalPane";
import { TerminalStatusBar } from "./TerminalStatusBar";
import { TerminalTabBar } from "./TerminalTabBar";
import { TerminalNotifications } from "./TerminalNotifications";

export function TerminalWorkspace() {
  return (
    <div className="terminal-workspace">
      <TerminalTabBar />
      <TerminalPane />
      <TerminalStatusBar />
      <TerminalNotifications />
    </div>
  );
}
