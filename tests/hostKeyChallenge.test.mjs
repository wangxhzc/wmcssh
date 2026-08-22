import assert from "node:assert/strict";
import test from "node:test";
import { parseHostKeyChallenge } from "../src/features/hosts/hostKeyChallenge.ts";

test("parses a complete host-key challenge", () => {
  const challenge = {
    hostname: "example.com",
    port: 22,
    keyType: "ED25519",
    fingerprint: "SHA256:abc",
    changed: false
  };
  assert.deepEqual(parseHostKeyChallenge({
    code: "host_key_unknown",
    message: "confirm",
    details: JSON.stringify(challenge),
    retryable: false
  }), challenge);
});

test("rejects malformed or unrelated host-key details", () => {
  assert.equal(parseHostKeyChallenge({
    code: "auth_failed",
    message: "failed",
    retryable: false
  }), undefined);
  assert.equal(parseHostKeyChallenge({
    code: "host_key_mismatch",
    message: "changed",
    details: "{}",
    retryable: false
  }), undefined);
});
