import assert from "node:assert/strict";
import test from "node:test";
import { terminalClipboardShortcut } from "../src/features/terminal/clipboardShortcuts.ts";

const key = (key, modifiers = {}) => ({ key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, isComposing: false, ...modifiers });

test("Linux clipboard shortcuts distinguish explicit copy from PRIMARY paste", () => {
  assert.equal(terminalClipboardShortcut(key("C", { ctrlKey: true, shiftKey: true }), true), "copy");
  assert.equal(terminalClipboardShortcut(key("v", { ctrlKey: true, shiftKey: true }), true), "paste");
  assert.equal(terminalClipboardShortcut(key("Insert", { ctrlKey: true }), true), "copy");
  assert.equal(terminalClipboardShortcut(key("Insert", { shiftKey: true }), true), "pastePrimary");
  assert.equal(terminalClipboardShortcut(key("Insert", { shiftKey: true }), false), "paste");
});

test("terminal control characters and IME input are not intercepted", () => {
  for (const letter of ["c", "v", "a", "z"]) {
    assert.equal(terminalClipboardShortcut(key(letter, { ctrlKey: true }), true), undefined);
  }
  for (const modifier of ["altKey", "metaKey", "isComposing"]) {
    assert.equal(terminalClipboardShortcut(key("c", { ctrlKey: true, shiftKey: true, [modifier]: true }), true), undefined);
  }
});
