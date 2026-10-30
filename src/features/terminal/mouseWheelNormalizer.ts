import type { Terminal } from "@xterm/xterm";

export function installMouseWheelNormalizer(element: HTMLElement, terminal: Terminal) {
  let dispatching = false;
  let remainder = 0;
  const handleWheel = (event: WheelEvent) => {
    if (dispatching) return;
    if (terminal.modes.mouseTrackingMode === "none" || event.shiftKey || event.ctrlKey || event.metaKey || !event.deltaY) {
      remainder = 0;
      return;
    }
    const screen = element.querySelector(".xterm-screen");
    const rowHeight = (screen?.getBoundingClientRect().height ?? 0) / terminal.rows;
    if (event.deltaMode === 0 && rowHeight <= 0) return;
    let lines = event.deltaY;
    if (event.deltaMode === 0) lines /= rowHeight;
    else if (event.deltaMode === 2) lines *= terminal.rows;
    if (event.altKey && terminal.options.fastScrollModifier === "alt") lines *= terminal.options.fastScrollSensitivity ?? 5;
    lines *= terminal.options.scrollSensitivity ?? 1;
    if (Math.sign(lines) !== Math.sign(remainder)) remainder = 0;
    remainder += lines;
    const count = Math.min(32, Math.floor(Math.abs(remainder)));
    const direction = Math.sign(remainder);
    remainder = (Math.abs(remainder) % 1) * direction;
    event.preventDefault();
    event.stopImmediatePropagation();
    // xterm 5.5 emits one mouse report per DOM event, ignoring its line count.
    dispatching = true;
    try {
      for (let index = 0; index < count; index++) {
        event.target?.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true, cancelable: true, deltaMode: 1, deltaY: direction,
          clientX: event.clientX, clientY: event.clientY,
          screenX: event.screenX, screenY: event.screenY,
          button: event.button, buttons: event.buttons, altKey: event.altKey
        }));
      }
    } finally {
      dispatching = false;
    }
  };
  element.addEventListener("wheel", handleWheel, { capture: true, passive: false });
  return { dispose: () => element.removeEventListener("wheel", handleWheel, { capture: true }) };
}
