import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function fixture(getHost) {
  const states = [];
  const effects = [];
  const connected = [];
  const transfers = [];
  let cursor = 0;
  const tab = { tabId: "tab", hostId: "filtered-out-host", kind: "terminal", title: "server", status: "connected" };
  const store = { tabs: [tab], setActiveTab() {} };
  const useTerminalStore = (select) => select(store);
  useTerminalStore.getState = () => store;
  const dependencies = {
    useTerminalStore, getHost,
    connectHost: async (host, credentials, afterTabId) => { connected.push({ host, credentials, afterTabId }); },
    openFileTransferTab: (host, afterTabId) => { transfers.push({ host, afterTabId }); },
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (value) => { states[index] = value; }];
    },
    useRef: () => ({ current: null }),
    useEffect: (effect) => { effects.push(effect); },
    useMemo: (factory) => factory(),
    useAnchoredMenuPosition: () => null,
    useTabReorder: () => ({ suppressClick: () => false }),
    sessionStatusLabel: { connected: "已连接" },
    jsx: (type, props) => ({ type, props }),
    jsxs: (type, props) => ({ type, props })
  };
  const source = readFileSync(new URL("../src/features/terminal/components/TerminalTabBar.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: () => dependencies });
  const render = () => {
    cursor = 0;
    effects.length = 0;
    return exports.TerminalTabBar();
  };
  const initial = render();
  initial.props.children[0].props.children[0].props.onContextMenu({ preventDefault() {}, stopPropagation() {} });
  render();
  const cleanup = effects[0]();
  return { render, cleanup, connected, transfers };
}

function find(node, predicate) {
  if (!node || typeof node !== "object") return;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat()) {
    const match = find(child, predicate);
    if (match) return match;
  }
}

test("tab copy and file transfer resolve a host independently of sidebar search results", async () => {
  const host = { id: "filtered-out-host", name: "server" };
  const view = fixture(async (id) => {
    assert.equal(id, host.id);
    return host;
  });
  await new Promise(setImmediate);
  const tree = view.render();
  for (const label of ["复制连接", "文件传输"]) {
    const button = find(tree, (node) => node.type === "button" && node.props.children === label);
    assert.equal(button.props.disabled, false);
    await button.props.onClick();
  }
  assert.deepEqual(view.connected, [{ host, credentials: undefined, afterTabId: "tab" }]);
  assert.deepEqual(view.transfers, [{ host, afterTabId: "tab" }]);
});

test("late host lookup does not update a dismissed menu", async () => {
  let resolve;
  const view = fixture(() => new Promise((done) => { resolve = done; }));
  view.cleanup();
  resolve({ id: "filtered-out-host" });
  await new Promise(setImmediate);
  const button = find(view.render(), (node) => node.type === "button" && node.props.children === "复制连接");
  assert.equal(button.props.disabled, true);
});

test("host lookup failure is shown and keeps host actions disabled", async () => {
  const view = fixture(async () => { throw "host deleted"; });
  await new Promise(setImmediate);
  const tree = view.render();
  assert.match(find(tree, (node) => node.props?.role === "alert").props.children, /host deleted/);
  assert.equal(find(tree, (node) => node.props?.children === "文件传输").props.disabled, true);
});
