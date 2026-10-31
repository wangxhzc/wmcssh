import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { stringToBase64 } from "../src/services/terminal/terminalCodec.ts";

function fixture(write) {
  const exports = {};
  const timers = new Map();
  let timerId = 0;
  const tab = { tabId: "tab", kind: "terminal", status: "connected", sessionId: "session" };
  const dependencies = {
    useTerminalStore: { getState: () => ({ tabs: [tab] }) },
    terminalRegistry: { getSessionId: () => tab.sessionId },
    sshWrite: write,
    stringToBase64,
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

test("one Ctrl+C sends one interrupt byte without waiting for a second keypress", async () => {
  const accepted = [];
  const { actions, timers } = fixture(async ({ dataBase64 }) => {
    accepted.push(Buffer.from(dataBase64, "base64"));
  });
  actions.queueTerminalInput("tab", "\x03");
  const timer = timers.values().next().value;
  assert.equal(typeof timer, "function");
  timer();
  await new Promise(setImmediate);
  assert.equal(timers.size, 0);
  assert.deepEqual(accepted, [Buffer.from([3])]);
  await actions.flushTerminalInput("tab");
  assert.equal(accepted.length, 1);
  actions.queueTerminalInput("tab", "\r");
  await actions.flushTerminalInput("tab");
  assert.deepEqual(accepted, [Buffer.from([3]), Buffer.from([13])]);
});

test("long input preserves Unicode characters across chunk boundaries and remains writable", async () => {
  const accepted = [];
  const { actions } = fixture(async ({ dataBase64 }) => {
    accepted.push(Buffer.from(dataBase64, "base64").toString());
  });
  const input = "a".repeat(1023) + String.fromCodePoint(0x1f600) + "b";
  actions.queueTerminalInput("tab", input);
  await actions.flushTerminalInput("tab");
  await actions.flushTerminalInput("tab");
  actions.queueTerminalInput("tab", "next");
  await actions.flushTerminalInput("tab");
  assert.equal(accepted.join(""), input + "next");
});
