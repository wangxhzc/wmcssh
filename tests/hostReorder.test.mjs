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
  const target = { dataset: { hostId: "b" }, getBoundingClientRect: () => ({ top: 100, height: 40 }) };
  const scroller = { scrollTop: 0, contains: () => true, getBoundingClientRect: () => ({ left: 0, right: 240, top: 0, bottom: 200 }) };
  const element = { captured: false, setPointerCapture() { this.captured = true; }, hasPointerCapture() { return this.captured; }, releasePointerCapture() { this.captured = false; } };
  const exports = {};
  const source = readFileSync(new URL("../src/features/hosts/useHostReorder.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, Date,
    window: { addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); } },
    document: { elementFromPoint: () => ({ closest: () => target }) },
    requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    require(name) {
      if (name !== "react") throw Error(name);
      return { useRef: (current) => ({ current }), useState: (value) => [value, () => {}], useEffect(fn) { cleanup = fn(); } };
    }
  });
  const hook = exports.useHostReorder({ current: scroller }, async (input) => moves.push(JSON.parse(JSON.stringify(input))));
  const event = (x, y) => ({ pointerId: 1, clientX: x, clientY: y, preventDefault() {} });
  const start = () => hook.start({ ...event(50, 110), button: 0, isPrimary: true, currentTarget: element }, "a");
  return { hook, moves, element, frames, scroller, start, cleanup: () => cleanup(), emit: (name, x, y) => listeners.get(name)?.(event(x, y)), escape: () => listeners.get("keydown")({ key: "Escape", preventDefault() {} }) };
}

test("small pointer movement preserves click and does not reorder", () => {
  const f = fixture(); f.start(); f.emit("pointermove", 52, 112); f.emit("pointerup", 52, 112);
  assert.equal(f.moves.length, 0);
  assert.equal(f.hook.suppressClick(), false);
  assert.equal(f.element.captured, false);
  f.cleanup();
});

test("drag commits target position and suppresses the following click", () => {
  const f = fixture(); f.start(); f.emit("pointermove", 50, 130); f.emit("pointerup", 50, 130);
  assert.deepEqual(f.moves, [{ hostId: "a", targetHostId: "b", after: true }]);
  assert.equal(f.hook.suppressClick(), true);
  assert.equal(f.element.captured, false);
  assert.equal(f.frames.size, 0);
  f.cleanup();
});

test("Escape and dropping outside the list cancel without saving", () => {
  for (const cancel of [f => f.escape(), f => f.emit("pointerup", 400, 130), f => f.emit("blur")]) {
    const f = fixture(); f.start(); f.emit("pointermove", 50, 130); cancel(f);
    assert.equal(f.moves.length, 0);
    assert.equal(f.element.captured, false);
    assert.equal(f.frames.size, 0);
    f.cleanup();
  }
});

test("dragging near the bottom scrolls without further pointer movement", () => {
  const f = fixture(); f.start(); f.emit("pointermove", 50, 195);
  const [id, tick] = f.frames.entries().next().value;
  f.frames.delete(id); tick(16);
  assert.ok(f.scroller.scrollTop > 0);
  f.escape(); assert.equal(f.frames.size, 0); f.cleanup();
});
