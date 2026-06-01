export type TerminalSettingsDto = {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontWeightBold: number;
  lineHeight: number;
  letterSpacing: number;
  cursorBlink: boolean;
  scrollback: number;
};

export const APP_TERMINAL_FONT_FAMILY =
  '"AppTerminalMono", "Sarasa Mono SC", "Noto Sans Mono CJK SC", Consolas, monospace';

export const defaultTerminalSettings: TerminalSettingsDto = {
  fontFamily: APP_TERMINAL_FONT_FAMILY,
  fontSize: 14,
  fontWeight: 400,
  fontWeightBold: 700,
  lineHeight: 1.2,
  letterSpacing: 0,
  cursorBlink: true,
  scrollback: 10000
};
