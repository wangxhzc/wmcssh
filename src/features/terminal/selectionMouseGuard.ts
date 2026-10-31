import type { Terminal } from "@xterm/xterm";

export function installSelectionMouseGuard(
  element: HTMLElement,
  terminal: Pick<Terminal, "hasSelection" | "modes">
) {
  const handleMouseMove = (event: MouseEvent) => {
    // SGR hover reports count as user input in xterm and clear Shift selections.
    // Keep hover local until a click or keyboard input ends the selection.
    if (event.buttons === 0 && terminal.modes.mouseTrackingMode === "any" && terminal.hasSelection()) {
      event.stopImmediatePropagation();
    }
  };

  element.addEventListener("mousemove", handleMouseMove, { capture: true });
  return { dispose: () => element.removeEventListener("mousemove", handleMouseMove, { capture: true }) };
}
