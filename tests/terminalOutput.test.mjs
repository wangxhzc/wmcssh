import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function fixture() {
  const writes = [];
  const callbacks = [];
  const resizes = [];
  class Terminal {
    parser = { registerOscHandler() { return { dispose() {} }; } };
    options = {};
    cols = 80;
    rows = 24;
    element = { offsetParent: {}, clientWidth: 800, clientHeight: 480 };
    resize(cols, rows) { this.cols = cols; this.rows = rows; }
    loadAddon() {}
    write(data, done) { writes.push(Buffer.from(data)); callbacks.push(done); }
    dispose() {}
  }
  const exports = {};
  const source = readFileSync(new URL("../src/features/terminal/terminalRegistry.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, {
    exports, Uint8Array, console,
    window: { addEventListener() {}, cancelAnimationFrame() {}, requestAnimationFrame() { throw Error("Background parsing must not wait for rendering"); } },
    document: { hasFocus: () => false, visibilityState: "hidden", addEventListener() {} },
    require(name) {
      if (name === "@xterm/xterm") return { Terminal };
      if (name === "@xterm/addon-web-links") return { WebLinksAddon: class {} };
      if (name === "@xterm/addon-fit") return { FitAddon: class {
        dimensions = { cols: 100, rows: 30 };
        proposeDimensions() { return this.dimensions; }
        fit() { throw Error("Resize must not clear the renderer through fit()"); }
      } };
      if (name.endsWith("types/settings")) return { defaultTerminalSettings: { letterSpacing: 0 } };
      if (name.endsWith("sshApi")) return { sshResize: async (size) => { resizes.push(size); } };
      if (name.endsWith("clipboardApi")) return { writeText: async () => {} };
      if (name.endsWith("remoteClipboard")) return { decodeRemoteClipboard: () => undefined };
      if (name.endsWith("terminalIntegration")) return { installTerminalIntegration: () => ({ dispose() {} }), activateTerminalLink() {} };
      throw Error(name);
    }
  });
  return { registry: exports.terminalRegistry, writes, callbacks, resizes };
}

test("background output larger than the old 4 MiB cap is parsed without losing bytes", () => {
  const { registry, writes, callbacks } = fixture();
  registry.create("tab");
  const expected = [];
  for (let index = 0; index < 170; index++) {
    const chunk = new Uint8Array(32768).fill(65 + index % 26);
    expected.push(Buffer.from(chunk));
    registry.writeByTabId("tab", chunk);
  }
  while (callbacks.length) callbacks.shift()();
  assert.deepEqual(Buffer.concat(writes), Buffer.concat(expected));
});

test("UTF-8 and cursor control bytes retain order across background chunks", () => {
  const { registry, writes, callbacks } = fixture();
  registry.create("tab");
  const expected = Buffer.from("中文\x1b[2J\x1b[H完成");
  for (const byte of expected) registry.writeByTabId("tab", new Uint8Array([byte]));
  while (callbacks.length) callbacks.shift()();
  assert.deepEqual(Buffer.concat(writes), expected);
});

test("output is acknowledged only after all its slices have been parsed", () => {
  const { registry, callbacks } = fixture();
  registry.create("tab");
  let acknowledged = 0;
  registry.writeByTabId("tab", new Uint8Array(65536).fill(65), () => acknowledged++);
  assert.equal(acknowledged, 0);
  callbacks.shift()();
  assert.equal(acknowledged, 0);
  callbacks.shift()();
  assert.equal(acknowledged, 1);
});

test("late callbacks from a disposed terminal cannot clear a replacement queue", () => {
  const { registry, callbacks } = fixture();
  registry.create("tab");
  registry.writeByTabId("tab", new Uint8Array([65]));
  registry.dispose("tab");
  registry.create("tab");
  let acknowledged = 0;
  registry.writeByTabId("tab", new Uint8Array([66]), () => acknowledged++);
  registry.writeByTabId("tab", new Uint8Array([67]), () => acknowledged++);
  while (callbacks.length) callbacks.shift()();
  assert.equal(acknowledged, 2);
});


test("terminal resize deduplicates unchanged geometry but synchronizes a new session", () => {
  const { registry, resizes } = fixture();
  const runtime = registry.create("tab");
  runtime.mounted = true;
  registry.fit("tab");
  assert.equal(runtime.terminal.cols, 100);
  registry.bindSession("tab", "first");
  registry.fitAndResize("tab");
  registry.fitAndResize("tab");
  assert.equal(resizes.length, 1);
  runtime.fitAddon.dimensions = { cols: 120, rows: 40 };
  registry.fitAndResize("tab");
  assert.equal(resizes.length, 2);
  assert.equal(runtime.terminal.rows, 40);
  registry.bindSession("tab", "second");
  registry.fitAndResize("tab");
  assert.equal(resizes.length, 3);
  assert.equal(resizes[2].sessionId, "second");
});

test("hidden and unmeasurable terminals do not resize or notify SSH", () => {
  const { registry, resizes } = fixture();
  const runtime = registry.create("tab");
  runtime.mounted = true;
  registry.bindSession("tab", "session");
  runtime.terminal.element.clientWidth = 0;
  registry.fitAndResize("tab");
  runtime.terminal.element.clientWidth = 800;
  runtime.fitAddon.dimensions = { cols: NaN, rows: 30 };
  registry.fitAndResize("tab");
  assert.equal(resizes.length, 0);
  assert.equal(runtime.terminal.cols, 80);
});
