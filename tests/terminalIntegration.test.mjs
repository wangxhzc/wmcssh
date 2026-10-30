import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { create } from "zustand";
import * as protocol from "../src/features/terminal/oscProtocol.ts";

function load(path, dependencies, globals = {}) {
  const exports = {};
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(compiled, { exports, require: () => dependencies, console, ...globals });
  return exports;
}

test("terminal integration registers title, directory and notification handlers and disposes them", async () => {
  const handlers = new Map();
  let titleHandler;
  let disposed = 0;
  const metadata = [];
  const notices = [];
  const opened = [];
  let attention = 0;
  const store = { tabs: [{ tabId: "tab", title: "server" }], setTerminalMetadata: (...args) => metadata.push(args) };
  const integration = load("../src/features/terminal/terminalIntegration.ts", {
    ...protocol,
    useTerminalStore: { getState: () => store },
    useTerminalNoticeStore: { getState: () => ({ push: (notice) => { notices.push(notice); return true; } }) },
    openWebLink: async (url) => { opened.push(url); },
    requestTerminalAttention: async () => { attention++; }
  }, { document: { hasFocus: () => false } });
  const registration = integration.installTerminalIntegration({
    onTitleChange(handler) { titleHandler = handler; return { dispose() { disposed++; } }; },
    parser: { registerOscHandler(code, handler) { handlers.set(code, handler); return { dispose() { disposed++; } }; } }
  }, "tab");
  titleHandler("\x07task");
  handlers.get(7)("file://remote/home/me");
  assert.equal(metadata[0][1].remoteTitle, "task");
  assert.equal(metadata[1][1].currentDirectory, "/home/me");
  handlers.get(7)("https://example.com");
  assert.equal(metadata.length, 2);
  handlers.get(777)("notify;Codex;done");
  assert.equal(notices[0].source, "server");
  assert.equal(notices[0].body, "done");
  assert.equal(attention, 1);
  const event = { ctrlKey: false, metaKey: false, preventDefault() {} };
  integration.activateTerminalLink(event, "https://example.com");
  assert.equal(opened.length, 0);
  event.ctrlKey = true;
  integration.activateTerminalLink(event, "file:///etc/passwd");
  assert.equal(opened.length, 0);
  integration.activateTerminalLink(event, "https://example.com");
  assert.equal(opened[0], "https://example.com/");
  store.tabs = [];
  handlers.get(9)("late output");
  assert.equal(notices.length, 1);
  registration.dispose();
  assert.equal(disposed, 4);
});

test("remote notices have global rate limits, deduplication, bounded retention and expiry", () => {
  let now = 100000;
  const { useTerminalNoticeStore } = load("../src/stores/terminalNoticeStore.ts", { create }, { Date: { now: () => now } });
  const store = useTerminalNoticeStore.getState();
  const notice = { tabId: "tab", source: "server", title: "Done", body: "task completed" };
  assert.equal(store.push(notice), true);
  assert.equal(store.push({ ...notice, body: "another" }), false);
  now += 1100;
  assert.equal(store.push(notice), false);
  assert.equal(store.push({ ...notice, body: "another" }), true);
  now += 1100;
  store.push({ ...notice, body: "third" });
  now += 1100;
  store.push({ ...notice, body: "fourth" });
  assert.equal(useTerminalNoticeStore.getState().notices.length, 3);
  assert.equal(useTerminalNoticeStore.getState().notices.at(-1).expiresAt, now + 8000);
  now += 10000;
  assert.equal(store.push(notice), true);
  const last = useTerminalNoticeStore.getState().notices.at(-1);
  store.dismiss(last.id);
  assert.ok(!useTerminalNoticeStore.getState().notices.some((item) => item.id === last.id));
});

test("opening SFTP from a terminal passes its directory only to the same host", () => {
  const created = [];
  const store = {
    tabs: [{ tabId: "terminal", hostId: "host", kind: "terminal", currentDirectory: "/work/project" }],
    createFileTransferTab(input) { created.push(input); return "file-tab"; },
    setActiveTab() {}
  };
  const { openFileTransferTab } = load("../src/features/file-transfer/actions.ts", { useTerminalStore: { getState: () => store } });
  openFileTransferTab({ id: "host", name: "server" }, "terminal");
  assert.equal(created[0].initialPath, "/work/project");
  openFileTransferTab({ id: "other", name: "other" }, "terminal");
  assert.equal(created[1].initialPath, undefined);
});
