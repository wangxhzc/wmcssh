import assert from "node:assert/strict";
import test from "node:test";
import { dropPositionInside } from "../src/features/file-transfer/dropTarget.ts";

test("native drop positions respect display scaling and target boundaries", () => {
  const bounds = { left: 240, top: 80, right: 1000, bottom: 700 };
  for (const scale of [1, 1.25, 1.5, 2]) {
    const inside = (x, y) => dropPositionInside({ x: x * scale, y: y * scale }, bounds, scale);
    assert.equal(inside(500, 300), true);
    assert.equal(inside(240, 80), true);
    assert.equal(inside(239, 300), false);
    assert.equal(inside(500, 79), false);
    assert.equal(inside(1000, 300), false);
    assert.equal(inside(500, 700), false);
  }
});
