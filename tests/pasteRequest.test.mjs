import assert from "node:assert/strict";
import test from "node:test";
import { createPasteRequest } from "../src/features/terminal/pasteRequest.ts";

test("all line endings require preview, including a single command with a trailing newline", () => {
  for (const text of ["ls\n", "ls\r", "ls\r\n", "a\nb", "\n"]) {
    const sent = [];
    const request = createPasteRequest(text, { sessionId: "one", terminal: { paste: (value) => sent.push(value) } }, () => true);
    assert.equal(request.needsPreview, true);
    assert.deepEqual(sent, []);
    request.send();
    request.send();
    assert.deepEqual(sent, [text]);
  }
  assert.equal(createPasteRequest("ls", { terminal: { paste() {} } }, () => true).needsPreview, false);
});

test("confirmation never sends an old preview to a reconnected or replaced terminal", () => {
  let calls = 0;
  const target = { sessionId: "old", terminal: { paste: () => calls++ } };
  const request = createPasteRequest("command\n", target, () => true);
  target.sessionId = "new";
  request.send();
  createPasteRequest("command\n", target, () => false).send();
  assert.equal(calls, 0);
});
