import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function fixture() {
  const listeners = new Map();
  const frames = new Map();
  const moves = [];
  let cleanup;
  let frameId = 0;
  const target = { dataset: { tabId: "b" }, getBoundingClientRect: () => ({ left: 100, width: 100 }) };
  const scroller = { scrollLeft: 0, contains: () => true, getBoundingClientRect: () => ({ left: 0, right: 300, top: 0, bottom: 25 }) };
  const element = { captured: false, setPointerCapture() { this.captured = true; }, hasPointerCapture() { return this.captured; }, releasePointerCapture() { this.captured = false; } };
  const exports = {};
  const source = readFileSync(new URL("../src/features/terminal/useTabReorder.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, Date,
    window: { addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); } },
    document: { elementFromPoint: () => ({ closest: () => target }) },
    requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    require: () => ({ useRef: (current) => ({ current }), useState: (value) => [value, () => {}], useEffect(fn) { cleanup = fn(); } })
  });
  const hook = exports.useTabReorder({ current: scroller }, (...args) => moves.push(args));
  const event = (x, y = 12) => ({ pointerId: 1, clientX: x, clientY: y, preventDefault() {} });
  const start = (overrides = {}) => hook.start({
    ...event(50), button: 0, isPrimary: true, currentTarget: element,
    target: { closest: () => null }, ...overrides
  }, "a");
  return {
    hook, moves, element, frames, scroller, target, start, listeners,
    cleanup: () => cleanup(),
    emit: (name, x, y) => listeners.get(name)?.(event(x, y)),
    escape: () => listeners.get("keydown")({ key: "Escape", preventDefault() {} })
  };
}

test("small pointer movement preserves normal tab clicks", () => {
  const f = fixture(); f.start(); f.emit("pointermove", 52); f.emit("pointerup", 52);
  assert.deepEqual(f.moves, []);
  assert.equal(f.hook.suppressClick(), false);
  assert.equal(f.element.captured, false);
  f.cleanup();
});

test("dragging uses the target midpoint and suppresses the click after release", () => {
  for (const [x, after] of [[125, false], [175, true]]) {
    const f = fixture(); f.start(); f.emit("pointermove", x); f.emit("pointerup", x);
    assert.deepEqual(f.moves, [["a", "b", after]]);
    assert.equal(f.hook.suppressClick(), true);
    assert.equal(f.element.captured, false);
    assert.equal(f.frames.size, 0);
    f.cleanup();
  }
});

test("Escape, blur, cancellation, lost capture, outside drop and unmount cancel dragging", () => {
  for (const cancel of [
    (f) => f.escape(), (f) => f.emit("blur"), (f) => f.emit("pointercancel"),
    (f) => f.emit("lostpointercapture"), (f) => f.emit("pointerup", 350),
    (f) => f.emit("pointerup", 175, 50), (f) => f.cleanup()
  ]) {
    const f = fixture(); f.start(); f.emit("pointermove", 175); cancel(f);
    assert.deepEqual(f.moves, []);
    assert.equal(f.element.captured, false);
    assert.equal(f.frames.size, 0);
    f.cleanup();
  }
});

test("close button and right mouse button do not start a reorder", () => {
  for (const overrides of [{ button: 2 }, { target: { closest: () => ({}) } }, { isPrimary: false }]) {
    const f = fixture(); f.start(overrides); f.emit("pointermove", 175); f.emit("pointerup", 175);
    assert.deepEqual(f.moves, []);
    assert.equal(f.hook.suppressClick(), false);
    f.cleanup();
  }
});

test("holding the pointer near either edge keeps scrolling the tab strip", () => {
  for (const [x, direction] of [[5, -1], [295, 1]]) {
    const f = fixture(); f.start(); f.emit("pointermove", x);
    const [id, tick] = f.frames.entries().next().value;
    f.frames.delete(id); tick(16);
    assert.ok(f.scroller.scrollLeft * direction > 0);
    f.escape(); assert.equal(f.frames.size, 0); f.cleanup();
    assert.equal(f.listeners.size, 0);
  }
});
