import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function fixture(write) {
  const exports = {};
  const timers = new Map();
  let timerId = 0;
  const tab = { tabId: "tab", kind: "terminal", status: "connected", sessionId: "session" };
  const dependencies = {
    useTerminalStore: { getState: () => ({ tabs: [tab] }) },
    terminalRegistry: { getSessionId: () => tab.sessionId },
    sshWrite: write,
    stringToBase64: (data) => Buffer.from(data).toString("base64"),
    normalizeAppError: (error) => error
  };
  const source = readFileSync(new URL("../src/features/terminal/actions.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, {
    exports, console, require: () => dependencies,
    window: {
      setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
      clearTimeout(id) { timers.delete(id); }
    }
  });
  return { actions: exports, tab, timers };
}

test("a full backend queue retries rejected input before later keystrokes", async () => {
  const accepted = [];
  let full = true;
  const { actions } = fixture(async ({ dataBase64 }) => {
    if (full) { full = false; throw { code: "input_buffer_full" }; }
    accepted.push(Buffer.from(dataBase64, "base64").toString());
  });
  actions.queueTerminalInput("tab", "first");
  await actions.flushTerminalInput("tab");
  actions.queueTerminalInput("tab", "second");
  await actions.flushTerminalInput("tab");
  assert.deepEqual(accepted, ["firstsecond"]);
});

test("disconnect during an in-flight rejection does not resurrect buffered input", async () => {
  let reject;
  const { actions, timers } = fixture(() => new Promise((_, fail) => { reject = fail; }));
  actions.queueTerminalInput("tab", "input");
  const flushing = actions.flushTerminalInput("tab");
  actions.stopTerminalInput("tab", "tab_closing");
  reject({ code: "input_buffer_full" });
  await flushing;
  assert.equal(timers.size, 0);
});
