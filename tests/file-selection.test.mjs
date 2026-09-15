import assert from "node:assert/strict";
import test from "node:test";
import { selectFile, reconcileSelection } from "../src/features/file-transfer/fileSelection.ts";

const order = ["a", "b", "c", "d", "e"];
const empty = { paths: [], directory: "/home" };

test("click replaces selection and Ctrl toggles individual entries", () => {
  let selection = selectFile(empty, order, "a");
  selection = selectFile(selection, order, "c", { toggle: true });
  assert.deepEqual(selection.paths, ["a", "c"]);
  selection = selectFile(selection, order, "a", { toggle: true });
  assert.deepEqual(selection.paths, ["c"]);
  assert.deepEqual(selectFile(selection, order, "b").paths, ["b"]);
});

test("Shift ranges retain their anchor when extending or shrinking in either direction", () => {
  let selection = selectFile(empty, order, "c");
  selection = selectFile(selection, order, "e", { range: true });
  assert.deepEqual(selection.paths, ["c", "d", "e"]);
  selection = selectFile(selection, order, "d", { range: true });
  assert.deepEqual(selection.paths, ["c", "d"]);
  selection = selectFile(selection, order, "a", { range: true });
  assert.deepEqual(selection.paths, ["a", "b", "c"]);
  assert.equal(selection.anchor, "c");
});

test("Ctrl+Shift adds a range and missing anchors fall back to the target", () => {
  let selection = selectFile(empty, order, "a");
  selection = selectFile(selection, order, "c", { toggle: true });
  assert.deepEqual(selectFile(selection, order, "e", { toggle: true, range: true }).paths, ["a", "c", "d", "e"]);
  assert.deepEqual(selectFile(empty, order, "b", { range: true }).paths, ["b"]);
  assert.equal(selectFile(selection, order, "missing"), selection);
});

test("refresh preserves existing selections; navigation clears them even for overlapping paths", () => {
  const selection = { paths: ["a", "c"], anchor: "a", focus: "c", directory: "/home" };
  assert.deepEqual(reconcileSelection(selection, "/home", ["c", "d"]), {
    paths: ["c"], anchor: undefined, focus: "c", directory: "/home"
  });
  assert.deepEqual(reconcileSelection(selection, "/other", order), { paths: [], directory: "/other" });
});
