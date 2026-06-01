import { TerminalPane } from "./TerminalPane";
import { TerminalStatusBar } from "./TerminalStatusBar";
import { TerminalTabBar } from "./TerminalTabBar";

export function TerminalWorkspace() {
  return (
    <div className="terminal-workspace">
      <TerminalTabBar />
      <TerminalPane />
      <TerminalStatusBar />
    </div>
  );
}
