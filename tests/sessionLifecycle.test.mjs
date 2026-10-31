import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function loadModule(path, dependencies, globals = {}) {
  const exports = {};
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  vm.runInNewContext(compiled, { exports, console, require: () => dependencies, ...globals });
  return exports;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("listeners resolving after effect cleanup are immediately removed", async () => {
  let cleanup;
  const registrations = [];
  const handlers = [];
  let removed = 0;
  const listen = (handler) => {
    handlers.push(handler);
    const registration = deferred();
    registrations.push(registration);
    return registration.promise;
  };
  const { useTerminalEvents } = loadModule("../src/features/terminal/hooks/useTerminalEvents.ts", {
    useEffect: (effect) => { cleanup = effect(); },
    useTerminalStore: (select) => select({ setTabStatus() {} }),
    listenSshStatus: listen, listenSshClosed: listen, listenSshError: listen
  });
  useTerminalEvents();
  cleanup();
  // A disposed callback must not access the store or start authentication.
  for (const handler of handlers) handler({});
  for (const registration of registrations) registration.resolve(() => { removed += 1; });
  await Promise.resolve();
  assert.equal(removed, 3);
});

test("listeners already registered are removed on normal cleanup", async () => {
  let cleanup;
  let removed = 0;
  const listen = async () => () => { removed += 1; };
  const { useTerminalEvents } = loadModule("../src/features/terminal/hooks/useTerminalEvents.ts", {
    useEffect: (effect) => { cleanup = effect(); },
    useTerminalStore: (select) => select({ setTabStatus() {} }),
    listenSshStatus: listen, listenSshClosed: listen, listenSshError: listen
  });
  useTerminalEvents();
  await Promise.resolve();
  cleanup();
  assert.equal(removed, 3);
});

function fileTransferFixture() {
  const opening = deferred();
  const closed = [];
  const listed = [];
  const tabs = [{ tabId: "tab", kind: "file-transfer" }];
  let loadDirectory;
  const captured = new Error("callback captured");
  const store = {
    tabs,
    bindFileTransferSession(tabId, sessionId) {
      tabs.find((tab) => tab.tabId === tabId).transferSessionId = sessionId;
    }
  };
  const useTerminalStore = (select) => select(store);
  useTerminalStore.getState = () => store;
  const { FileTransferView } = loadModule("../src/features/file-transfer/components/FileTransferView.tsx", {
    useRef: (current) => ({ current }),
    useState: (initial) => [initial, () => {}],
    useEffect() {},
    useCallback(callback) { loadDirectory = callback; throw captured; },
    useTerminalStore,
    useTransferQueueStore: (select) => select({ tasks: [] }),
    useAnchoredMenuPosition() {},
    useFileDrop() {},
    openFileTransferSession: () => opening.promise,
    closeFileTransferSession: async (input) => { closed.push(input.transferSessionId); },
    listRemoteDirectory: async (input) => {
      listed.push(input.transferSessionId);
      return { path: "/", entries: [] };
    },
    reconcileSelection: (selection) => selection
  });
  assert.throws(() => FileTransferView({ tabId: "tab", hostId: "host", active: true }), (error) => error === captured);
  return { loadDirectory, opening, closed, listed, tabs };
}

test("closing a file tab during connection releases the late SFTP session", async () => {
  const { loadDirectory, opening, closed, listed, tabs } = fileTransferFixture();
  const loading = loadDirectory();
  tabs.length = 0;
  opening.resolve({ transferSessionId: "sftp" });
  await loading;
  assert.deepEqual(closed, ["sftp"]);
  assert.deepEqual(listed, []);
});

test("an open file tab binds its connection and loads its directory", async () => {
  const { loadDirectory, opening, closed, listed, tabs } = fileTransferFixture();
  const loading = loadDirectory();
  opening.resolve({ transferSessionId: "sftp" });
  await loading;
  assert.equal(tabs[0].transferSessionId, "sftp");
  assert.deepEqual(closed, []);
  assert.deepEqual(listed, ["sftp"]);
});

test("terminal session is bound before early worker events and preserves their status", async () => {
  const tabs = [];
  const bindings = [];
  let runtime;
  const store = {
    tabs,
    createTerminalTab() {
      tabs.push({ tabId: "tab", kind: "terminal" });
      return "tab";
    },
    setActiveTab() {},
    setTabStatus(_tabId, status) { tabs[0].status = status; },
    bindSession(_tabId, sessionId) { tabs[0].sessionId = sessionId; }
  };
  const { connectHost } = loadModule("../src/features/terminal/actions.ts", {
    Channel: class {},
    useTerminalStore: { getState: () => store },
    sessionTabIndex: { bind: (sessionId, tabId) => bindings.push([sessionId, tabId]) },
    terminalRegistry: {
      get: () => runtime,
      create() { runtime = {}; },
      bindDataChannel(_tabId, channel) { runtime.dataChannel = channel; },
      bindSession(_tabId, sessionId) { runtime.sessionId = sessionId; },
      fitAndResize() { assert.equal(tabs[0].status, "connected"); }
    },
    sshConnect: async (input) => {
      assert.equal(tabs[0].sessionId, input.sessionId);
      assert.equal(runtime.sessionId, input.sessionId);
      assert.equal(bindings[0][0], input.sessionId);
      store.setTabStatus("tab", "connected");
      return { sessionId: input.sessionId };
    }
  }, { crypto: { randomUUID: () => "session" } });
  await connectHost({ id: "host", name: "test" }, { username: "root", authType: "password" });
  assert.equal(tabs[0].status, "connected");
});
