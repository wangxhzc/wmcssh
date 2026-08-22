import assert from "node:assert/strict";
import test from "node:test";
import {
  averageTransferSpeed,
  formatTransferBytes,
  transferPercent
} from "../src/features/file-transfer/transferQueue.ts";

test("formats transfer sizes and clamps progress", () => {
  assert.equal(formatTransferBytes(0), "0 B");
  assert.equal(formatTransferBytes(1536), "1.50 KB");
  assert.equal(transferPercent({ status: "running", transferredBytes: 150, totalBytes: 100 }), 100);
  assert.equal(transferPercent({ status: "completed", transferredBytes: 0, totalBytes: 0 }), 100);
  assert.equal(transferPercent({ status: "queued", transferredBytes: 0, totalBytes: 0 }), 0);
});

test("computes average speed only for running tasks", () => {
  assert.equal(averageTransferSpeed({
    status: "running",
    startedAt: 1000,
    transferredBytes: 2048
  }, 3000), 1024);
  assert.equal(averageTransferSpeed({
    status: "completed",
    startedAt: 1000,
    transferredBytes: 2048
  }, 3000), undefined);
});
