import type { Terminal } from "@xterm/xterm";

export function installSelectionMouseGuard(
  element: HTMLElement,
  terminal: Pick<Terminal, "hasSelection" | "modes">
) {
  const handleMouseDown = (event: MouseEvent) => {
    if (event.button === 0 && event.shiftKey && terminal.modes.mouseTrackingMode === "none") {
      // xterm treats Shift-click in normal mode as extending an old selection.
      // Keep the original event/target, but start a fresh selection at this click.
      Object.defineProperty(event, "shiftKey", { value: false, configurable: true });
    }
  };

  const handleMouseMove = (event: MouseEvent) => {
    // SGR hover reports count as user input in xterm and clear Shift selections.
    // Keep hover local until a click or keyboard input ends the selection.
    if (event.buttons === 0 && terminal.modes.mouseTrackingMode === "any" && terminal.hasSelection()) {
      event.stopImmediatePropagation();
    }
  };

  element.addEventListener("mousedown", handleMouseDown, { capture: true });
  element.addEventListener("mousemove", handleMouseMove, { capture: true });
  return { dispose: () => {
    element.removeEventListener("mousedown", handleMouseDown, { capture: true });
    element.removeEventListener("mousemove", handleMouseMove, { capture: true });
  } };
}
