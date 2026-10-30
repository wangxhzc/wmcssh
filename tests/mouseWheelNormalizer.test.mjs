import assert from "node:assert/strict";
import test from "node:test";
import { installMouseWheelNormalizer } from "../src/features/terminal/mouseWheelNormalizer.ts";

class Wheel extends Event {
  constructor(type, options = {}) {
    super(type, options);
    const { bubbles, cancelable, ...wheelOptions } = options;
    Object.assign(this, { deltaMode: 0, deltaY: 0, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...wheelOptions });
  }
}
globalThis.WheelEvent = Wheel;

function fixture() {
  const element = new EventTarget();
  element.querySelector = () => ({ getBoundingClientRect: () => ({ height: 480 }) });
  const terminal = { rows: 24, modes: { mouseTrackingMode: "any" }, options: {} };
  const guard = installMouseWheelNormalizer(element, terminal);
  const forwarded = [];
  element.addEventListener("wheel", (event) => forwarded.push(event));
  const wheel = (deltaY, deltaMode = 1, options = {}) => element.dispatchEvent(new Wheel("wheel", { cancelable: true, deltaY, deltaMode, clientX: 10, clientY: 20, ...options }));
  return { terminal, guard, forwarded, wheel };
}

test("mouse reports preserve multiple lines and coordinates in either direction", () => {
  const f = fixture();
  f.wheel(3);
  assert.equal(f.forwarded.length, 3);
  assert.ok(f.forwarded.every((event) => event.deltaY === 1 && event.clientX === 10 && event.clientY === 20));
  f.wheel(-2);
  assert.deepEqual(f.forwarded.map((event) => event.deltaY), [1, 1, 1, -1, -1]);
});

test("touchpad fractions accumulate and reverse direction without stale movement", () => {
  const f = fixture();
  f.wheel(8, 0); f.wheel(8, 0);
  assert.equal(f.forwarded.length, 0);
  f.wheel(8, 0);
  assert.equal(f.forwarded.length, 1);
  f.wheel(-16, 0);
  assert.equal(f.forwarded.length, 1);
  f.wheel(-4, 0);
  assert.equal(f.forwarded.length, 2);
});

test("normal scrollback and modified wheel events retain native processing", () => {
  const f = fixture();
  f.terminal.modes.mouseTrackingMode = "none";
  f.wheel(3);
  assert.equal(f.forwarded.length, 1);
  assert.equal(f.forwarded[0].deltaY, 3);
  f.terminal.modes.mouseTrackingMode = "any";
  for (const modifier of ["shiftKey", "ctrlKey", "metaKey"]) f.wheel(3, 1, { [modifier]: true });
  assert.equal(f.forwarded.length, 4);
  f.guard.dispose();
  f.wheel(3);
  assert.equal(f.forwarded.length, 5);
});

test("very large gestures have a bounded report count", () => {
  const f = fixture();
  f.wheel(10000);
  assert.equal(f.forwarded.length, 32);
});
