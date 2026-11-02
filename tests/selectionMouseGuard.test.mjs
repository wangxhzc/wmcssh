import assert from "node:assert/strict";
import test from "node:test";
import { installSelectionMouseGuard } from "../src/features/terminal/selectionMouseGuard.ts";

function fixture() {
  const element = new EventTarget();
  const terminal = { selected: true, modes: { mouseTrackingMode: "any" }, hasSelection() { return this.selected; } };
  const guard = installSelectionMouseGuard(element, terminal);
  let forwarded = 0;
  element.addEventListener("mousemove", () => { forwarded++; terminal.selected = false; });
  const move = (buttons = 0) => {
    const event = new Event("mousemove");
    Object.defineProperty(event, "buttons", { value: buttons });
    element.dispatchEvent(event);
  };
  return { terminal, guard, move, forwarded: () => forwarded };
}

test("hover after releasing Shift keeps the local selection and does not report to the remote app", () => {
  const { terminal, move, forwarded } = fixture();
  move();
  move();
  assert.equal(terminal.selected, true);
  assert.equal(forwarded(), 0);
});

test("mouse dragging and hover without a selection still reach the remote app", () => {
  const { terminal, move, forwarded } = fixture();
  move(1);
  assert.equal(terminal.selected, false);
  move();
  assert.equal(forwarded(), 2);
});

test("other tracking modes are unaffected and disposal removes the guard", () => {
  const { terminal, guard, move, forwarded } = fixture();
  terminal.modes.mouseTrackingMode = "drag";
  move();
  assert.equal(forwarded(), 1);
  terminal.modes.mouseTrackingMode = "any";
  terminal.selected = true;
  guard.dispose();
  move();
  assert.equal(forwarded(), 2);
});

test("Shift left click starts a fresh selection in normal terminal mode", () => {
  const { terminal, guard } = fixture();
  const element = new EventTarget();
  terminal.modes.mouseTrackingMode = "none";
  const installed = installSelectionMouseGuard(element, terminal);
  const click = (button, shiftKey) => {
    const event = new Event("mousedown");
    Object.defineProperties(event, {
      button: { value: button },
      shiftKey: { value: shiftKey, configurable: true }
    });
    element.dispatchEvent(event);
    return event.shiftKey;
  };
  assert.equal(click(0, true), false);
  assert.equal(click(0, false), false);
  assert.equal(click(2, true), true);
  for (const mode of ["x10", "vt200", "drag", "any"]) {
    terminal.modes.mouseTrackingMode = mode;
    assert.equal(click(0, true), true);
  }
  terminal.modes.mouseTrackingMode = "none";
  installed.dispose();
  assert.equal(click(0, true), true);
  guard.dispose();
});
