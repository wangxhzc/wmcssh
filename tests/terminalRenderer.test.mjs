import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function fixture(failure) {
  let disposed = 0;
  let unsubscribed = 0;
  let onLoss;
  const modes = [];
  const addon = { onContextLoss(callback) {
    onLoss = callback;
    return { dispose() { unsubscribed++; } };
  }, dispose() { disposed++; } };
  const exports = {};
  const source = readFileSync(new URL("../src/features/terminal/terminalRenderer.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, console: { warn() {} },
    require: () => ({ WebglAddon: class { constructor() { if (failure === "constructor") throw Error("unsupported GPU"); return addon; } } })
  });
  const terminal = { loadAddon(value) {
    assert.equal(value, addon);
    if (failure === "activation") throw Error("context unavailable");
  } };
  return { install: () => exports.installTerminalRenderer(terminal, mode => modes.push(mode)), modes,
    loss: () => onLoss(), disposed: () => disposed, unsubscribed: () => unsubscribed };
}

test("GPU context loss releases the addon and falls back once", () => {
  const f = fixture();
  const renderer = f.install();
  assert.deepEqual(f.modes, [false, true]);
  f.loss(); renderer.dispose();
  assert.deepEqual(f.modes, [false, true, false]);
  assert.equal(f.disposed(), 1);
  assert.equal(f.unsubscribed(), 1);
});

test("unsupported GPUs and failed activation preserve the default renderer", () => {
  for (const failure of ["constructor", "activation"]) {
    const f = fixture(failure);
    assert.doesNotThrow(() => f.install().dispose());
    assert.equal(f.disposed(), failure === "activation" ? 1 : 0);
    assert.deepEqual(f.modes, [false]);
  }
});
