import assert from "node:assert/strict";
import test from "node:test";
import xterm from "@xterm/xterm";
import { defaultTerminalTheme as theme } from "../src/features/terminal/terminalTheme.ts";

const normal = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
const bright = normal.map((name) => `bright${name[0].toUpperCase()}${name.slice(1)}`);
function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((value) => {
    const channel = parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

test("ANSI theme provides 16 distinct colors with brighter bright variants", () => {
  const colors = [...normal, ...bright].map((name) => theme[name]);
  for (const color of colors) assert.match(color, /^#[0-9a-f]{6}$/i);
  assert.equal(new Set(colors.map((color) => color.toLowerCase())).size, 16);
  for (let i = 0; i < 8; i++) assert.ok(luminance(theme[bright[i]]) > luminance(theme[normal[i]]), normal[i]);
  for (const name of [...normal.slice(1), ...bright.slice(1)]) {
    const contrast = (luminance(theme[name]) + 0.05) / (luminance(theme.background) + 0.05);
    assert.ok(contrast >= 4.5, `${name} text contrast: ${contrast}`);
  }
});

async function parse(t, sequence) {
  const terminal = new xterm.Terminal({ cols: 80, rows: 24, theme, allowProposedApi: true });
  t.after(() => terminal.dispose());
  await new Promise((resolve) => terminal.write(sequence, resolve));
  return terminal.buffer.active.getLine(0);
}

test("ANSI normal and bright SGR codes select all 16 foreground/background indices", async (t) => {
  let sequence = "";
  for (let i = 0; i < 16; i++) sequence += `\x1b[${i < 8 ? 30 + i : 90 + i - 8};${i < 8 ? 40 + i : 100 + i - 8}mX`;
  const line = await parse(t, sequence);
  for (let i = 0; i < 16; i++) {
    const cell = line.getCell(i);
    assert.ok(cell.isFgPalette() && cell.isBgPalette());
    assert.equal(cell.getFgColor(), i);
    assert.equal(cell.getBgColor(), i);
  }
});

test("256-color SGR supports every foreground and background index", async (t) => {
  for (let start = 0; start < 256; start += 64) {
    const sequence = Array.from({ length: 64 }, (_, i) => `\x1b[38;5;${start + i};48;5;${start + i}mX`).join("");
    const line = await parse(t, sequence);
    for (let i = 0; i < 64; i++) {
      const cell = line.getCell(i);
      assert.ok(cell.isFgPalette() && cell.isBgPalette());
      assert.equal(cell.getFgColor(), start + i);
      assert.equal(cell.getBgColor(), start + i);
    }
  }
});

test("True Color preserves RGB channels and SGR resets foreground/background", async (t) => {
  const samples = [[0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 255, 0], [0, 0, 255], [17, 128, 239]];
  const sequence = samples.map(([r, g, b]) => `\x1b[38;2;${r};${g};${b};48;2;${b};${r};${g}mX`).join("");
  const line = await parse(t, `${sequence}\x1b[39mF\x1b[49mB\x1b[31;44mC\x1b[0mD`);
  samples.forEach(([r, g, b], i) => {
    const cell = line.getCell(i);
    assert.ok(cell.isFgRGB() && cell.isBgRGB());
    assert.equal(cell.getFgColor(), (r << 16) | (g << 8) | b);
    assert.equal(cell.getBgColor(), (b << 16) | (r << 8) | g);
  });
  assert.ok(line.getCell(6).isFgDefault() && line.getCell(6).isBgRGB());
  assert.ok(line.getCell(7).isFgDefault() && line.getCell(7).isBgDefault());
  assert.ok(line.getCell(9).isFgDefault() && line.getCell(9).isBgDefault());
});
