import assert from "node:assert/strict";
import test from "node:test";
import { cleanTerminalText, remoteDirectory, remoteNotification, webLink } from "../src/features/terminal/oscProtocol.ts";

test("OSC 7 accepts remote absolute paths and decodes Unicode and spaces", () => {
  assert.equal(remoteDirectory("file://remote-server/home/user/my%20project/%E4%B8%AD%E6%96%87"), "/home/user/my project/中文");
  assert.equal(remoteDirectory("file:///"), "/");
  for (const value of ["/tmp", "https://host/tmp", "file://host/tmp%00x", "file://host/tmp%0Ax", "file://host/tmp%ZZ", "file://host/tmp?q=x", "file://host/tmp#x"]) {
    assert.equal(remoteDirectory(value), undefined);
  }
});

test("OSC notifications ignore progress and unsupported subcommands", () => {
  assert.deepEqual(remoteNotification(9, "Done"), { title: "终端通知", body: "Done" });
  assert.deepEqual(remoteNotification(777, "notify;Codex;Done;details"), { title: "Codex", body: "Done;details" });
  for (const value of ["4;1;50", "", "4;0"]) assert.equal(remoteNotification(9, value), undefined);
  for (const value of ["notify;title", "other;title;body", "notify;;"]) assert.equal(remoteNotification(777, value), undefined);
  assert.equal(remoteNotification(9, "x".repeat(8193)), undefined);
  assert.equal(cleanTerminalText("  hi\x1b\x07\x9d  "), "hi");
  assert.equal(cleanTerminalText("x".repeat(300)).length, 256);
});

test("links only allow HTTP/HTTPS without credentials and control characters", () => {
  assert.equal(webLink("https://example.com/a?q=1#b"), "https://example.com/a?q=1#b");
  assert.equal(webLink("http://localhost:3000"), "http://localhost:3000/");
  for (const value of ["javascript:alert(1)", "file:///tmp/a", "https://user:pass@example.com", "https://example.com/\n", "invalid"]) assert.equal(webLink(value), undefined);
});
