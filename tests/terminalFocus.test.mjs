import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function fixture() {
  let calls = 0;
  class Element {
    matches() { return true; }
  }
  const state = { activeTabId: "a" };
  const element = { getClientRects: () => [1], contains: () => false };
  const document = { hasFocus: () => true, visibilityState: "visible", querySelector: () => null, activeElement: null };
  const exports = {};
  const source = readFileSync(new URL("../src/features/terminal/terminalFocus.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, document, HTMLElement: Element,
    require: (name) => name.includes("terminalStore")
      ? { useTerminalStore: { getState: () => state } }
      : { terminalRegistry: { get: () => ({ terminal: { element, focus: () => calls++ } }) } }
  });
  return { focus: () => exports.focusTerminal("a"), state, document, element, Element, calls: () => calls };
}

test("explicit activation can refocus the current visible terminal repeatedly", () => {
  const f = fixture();
  f.focus(); f.focus();
  assert.equal(f.calls(), 2);
});

test("focus requests respect tabs, window visibility, modals and other editors", () => {
  const changes = [
    f => { f.state.activeTabId = "b"; },
    f => { f.document.hasFocus = () => false; },
    f => { f.document.visibilityState = "hidden"; },
    f => { f.document.querySelector = () => ({}); },
    f => { f.element.getClientRects = () => []; },
    f => { f.document.activeElement = new f.Element(); }
  ];
  for (const change of changes) {
    const f = fixture(); change(f); f.focus();
    assert.equal(f.calls(), 0);
  }
  const f = fixture();
  f.document.activeElement = new f.Element();
  f.element.contains = () => true;
  f.focus();
  assert.equal(f.calls(), 1);
});
