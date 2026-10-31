import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { create } from "zustand";
import ts from "typescript";

function newStore() {
  const source = readFileSync(new URL("../src/stores/terminalStore.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: () => ({ create }), crypto: { randomUUID } });
  return exports.useTerminalStore;
}

for (const method of ["createTerminalTab", "createFileTransferTab"]) {
  test(`${method} inserts after its source even when another tab is active`, () => {
    const store = newStore();
    const first = store.getState().createTerminalTab({ hostId: "host", title: "first" });
    const last = store.getState().createTerminalTab({ hostId: "host", title: "last" });
    const inserted = store.getState()[method]({ hostId: "host", title: "new", afterTabId: first });
    assert.deepEqual(Array.from(store.getState().tabs, (tab) => tab.tabId), [first, inserted, last]);
    assert.equal(store.getState().activeTabId, inserted);
  });

  test(`${method} appends when its source was closed or no position was specified`, () => {
    const store = newStore();
    const first = store.getState().createTerminalTab({ hostId: "host", title: "first" });
    const second = store.getState()[method]({ hostId: "host", title: "new", afterTabId: "closed-tab" });
    const third = store.getState()[method]({ hostId: "host", title: "new" });
    assert.deepEqual(Array.from(store.getState().tabs, (tab) => tab.tabId), [first, second, third]);
  });
}

test("moving mixed tabs preserves sessions and the active tab in both directions", () => {
  const store = newStore();
  const terminal = store.getState().createTerminalTab({ hostId: "host", title: "terminal" });
  const file = store.getState().createFileTransferTab({ hostId: "host", title: "file" });
  const last = store.getState().createTerminalTab({ hostId: "host", title: "last" });
  store.getState().bindSession(terminal, "ssh-session");
  store.getState().bindFileTransferSession(file, "sftp-session");
  const originalTabs = [...store.getState().tabs];
  store.getState().moveTab(terminal, file, true);
  assert.deepEqual(Array.from(store.getState().tabs, (tab) => tab.tabId), [file, terminal, last]);
  store.getState().moveTab(last, file, false);
  assert.deepEqual(Array.from(store.getState().tabs, (tab) => tab.tabId), [last, file, terminal]);
  assert.equal(store.getState().activeTabId, last);
  for (const tab of originalTabs) assert.equal(store.getState().tabs.find((item) => item.tabId === tab.tabId), tab);
});

test("moving missing tabs or onto themselves leaves the order unchanged", () => {
  const store = newStore();
  const tabId = store.getState().createTerminalTab({ hostId: "host", title: "terminal" });
  const original = store.getState().tabs;
  store.getState().moveTab(tabId, tabId, true);
  store.getState().moveTab("closed", tabId, false);
  store.getState().moveTab(tabId, "closed", true);
  assert.equal(store.getState().tabs, original);
});
