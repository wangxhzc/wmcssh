import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeTerminalSettings,
  terminalSettingsChanged
} from "../src/features/settings/terminalSettingsDraft.ts";

const baseSettings = {
  fontFamily: "monospace",
  fontSize: 14,
  fontWeight: 400,
  fontWeightBold: 700,
  lineHeight: 1.2,
  letterSpacing: 0,
  cursorBlink: true,
  scrollback: 10000
};

test("detects terminal setting drafts that differ from persisted settings", () => {
  assert.equal(terminalSettingsChanged(baseSettings, { ...baseSettings }), false);
  assert.equal(terminalSettingsChanged(baseSettings, { ...baseSettings, fontSize: 16 }), true);
});

test("normalizes terminal settings to supported UI ranges", () => {
  assert.deepEqual(normalizeTerminalSettings({
    ...baseSettings,
    fontSize: 64,
    fontWeight: 455,
    fontWeightBold: 40,
    lineHeight: 0.5,
    letterSpacing: 3,
    scrollback: 99.6
  }), {
    ...baseSettings,
    fontSize: 48,
    fontWeight: 500,
    fontWeightBold: 100,
    lineHeight: 1,
    letterSpacing: 1,
    scrollback: 100
  });
});
