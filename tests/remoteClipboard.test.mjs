import assert from "node:assert/strict";
import test from "node:test";
import { decodeRemoteClipboard } from "../src/features/terminal/remoteClipboard.ts";

test("OSC 52 decodes clipboard writes as UTF-8", () => {
  const text = "远程 Codex\nhello 🚀";
  const encoded = Buffer.from(text).toString("base64");
  for (const target of ["", "c", "s", "cs"]) {
    assert.equal(decodeRemoteClipboard(`${target};${encoded}`), text);
  }
  assert.equal(decodeRemoteClipboard("c;"), "");
});

test("OSC 52 ignores queries, unsupported selections and invalid payloads", () => {
  for (const data of ["c;?", "p;aGk=", "c;%%%", "c;/w==", "missing separator", `c;${"A".repeat(1024 * 1024 + 4)}`]) {
    assert.equal(decodeRemoteClipboard(data), undefined);
  }
});
