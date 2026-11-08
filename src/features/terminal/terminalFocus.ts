import { useTerminalStore } from "../../stores/terminalStore";
import { terminalRegistry } from "./terminalRegistry";

/** Focus only the visible session, without escaping a modal or activating the window. */
export function focusTerminal(tabId: string) {
  if (useTerminalStore.getState().activeTabId !== tabId || !document.hasFocus() ||
      document.visibilityState !== "visible" || document.querySelector('[aria-modal="true"]')) return;
  const runtime = terminalRegistry.get(tabId);
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && focused.matches("input, textarea, select, [contenteditable='true']") &&
      !runtime?.terminal.element?.contains(focused)) return;
  if (runtime?.terminal.element?.getClientRects().length) runtime.terminal.focus();
}
