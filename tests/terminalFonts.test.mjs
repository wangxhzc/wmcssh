import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function fixture() {
  const requests = [];
  const exports = {};
  const source = readFileSync(new URL("../src/features/terminal/terminalFonts.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports,
    console: { warn() {} },
    document: { fonts: { load(face, sample) {
      return new Promise((resolve, reject) => requests.push({ face, sample, resolve, reject }));
    } } }
  });
  return { load: exports.loadTerminalFonts, requests };
}

const settings = { fontFamily: '"AppTerminalMono", monospace', fontSize: 14, fontWeight: 500, fontWeightBold: 700 };

test("waits for measurement, display and bold fonts before declaring readiness", async () => {
  const { load, requests } = fixture();
  let ready = false;
  const pending = load(settings).then(() => { ready = true; });
  assert.deepEqual(requests.map(r => r.face), [
    '400 14px "AppTerminalMono", monospace',
    '500 14px "AppTerminalMono", monospace',
    '700 14px "AppTerminalMono", monospace'
  ]);
  requests[0].resolve([]); requests[1].resolve([]);
  await Promise.resolve(); assert.equal(ready, false);
  requests[2].resolve([]); await pending; assert.equal(ready, true);
});

test("simultaneous terminals share font loading while changed fonts load separately", async () => {
  const { load, requests } = fixture();
  const first = load(settings);
  assert.equal(load(settings), first);
  assert.equal(requests.length, 3);
  const changed = load({ ...settings, fontFamily: "monospace" });
  assert.notEqual(changed, first);
  assert.equal(requests.length, 6);
  for (const request of requests) request.resolve([]);
  await Promise.all([first, changed]);
});

test("font failure permits fallback and can be retried on the next terminal", async () => {
  const { load, requests } = fixture();
  const failed = load(settings);
  requests[0].reject(Error("unavailable"));
  requests[1].resolve([]); requests[2].resolve([]);
  await failed;
  const retry = load(settings);
  assert.equal(requests.length, 6);
  for (const request of requests.slice(3)) request.resolve([]);
  await retry;
});
