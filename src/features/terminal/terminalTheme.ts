import type { ITheme } from "@xterm/xterm";

export const defaultTerminalTheme = {
  background: "#1C1C1C",
  foreground: "#E4E4E4",
  cursor: "#7AA2D6",
  cursorAccent: "#1C1C1C",
  selectionBackground: "#7AA2D6",
  selectionForeground: "#181818",
  selectionInactiveBackground: "#425F7F",
  black: "#181818",
  red: "#C97B7B",
  green: "#81B29A",
  yellow: "#D0AD78",
  blue: "#7AA2D6",
  magenta: "#B58ABF",
  cyan: "#78B8C4",
  white: "#D0D0D0",
  brightBlack: "#6F6F6F",
  brightRed: "#E8A0A0",
  brightGreen: "#A4D4B8",
  brightYellow: "#E8CF9A",
  brightBlue: "#A0C4F0",
  brightMagenta: "#D8AFE0",
  brightCyan: "#A0DAE4",
  brightWhite: "#F4F4F4"
} as const satisfies ITheme;
