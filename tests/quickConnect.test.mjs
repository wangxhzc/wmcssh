import assert from "node:assert/strict";
import test from "node:test";
import {
  findMatchingQuickConnectHost,
  parseQuickConnectCommand
} from "../src/features/hosts/quickConnect.ts";

test("parses supported quick-connect forms", () => {
  assert.deepEqual(parseQuickConnectCommand("172.16.1.1"), {
    hostname: "172.16.1.1", username: undefined, port: 22
  });
  assert.deepEqual(parseQuickConnectCommand("root@172.16.1.1"), {
    hostname: "172.16.1.1", username: "root", port: 22
  });
  assert.deepEqual(parseQuickConnectCommand("  root@example.com:2222  "), {
    hostname: "example.com", username: "root", port: 2222
  });
  assert.deepEqual(parseQuickConnectCommand("ssh 10.0.0.1"), {
    hostname: "10.0.0.1",
    username: undefined,
    port: 22
  });
  assert.deepEqual(parseQuickConnectCommand("ssh root@example.com:2222"), {
    hostname: "example.com",
    username: "root",
    port: 2222
  });
});

test("rejects malformed commands and invalid ports", () => {
  assert.throws(() => parseQuickConnectCommand(""));
  assert.throws(() => parseQuickConnectCommand("root@"));
  assert.throws(() => parseQuickConnectCommand("172.16.1.1 extra"));
  assert.throws(() => parseQuickConnectCommand("172.16.1.1:0"), /1 到 65535/);
  assert.throws(() => parseQuickConnectCommand("ssh example.com:0"), /1 到 65535/);
  assert.throws(() => parseQuickConnectCommand("ssh example.com:65536"), /1 到 65535/);
});

test("matches an existing host by case-insensitive hostname and exact port", () => {
  const hosts = [
    { id: "one", hostname: "Example.COM", port: 22 },
    { id: "two", hostname: "example.com", port: 2222 }
  ];
  assert.equal(
    findMatchingQuickConnectHost(hosts, { hostname: "example.com", port: 22 })?.id,
    "one"
  );
  assert.equal(
    findMatchingQuickConnectHost(hosts, { hostname: "example.com", port: 2200 }),
    undefined
  );
});
