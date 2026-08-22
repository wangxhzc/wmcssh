import type { TerminalSettingsDto } from "../../types/settings";

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function terminalSettingsChanged(
  left: TerminalSettingsDto,
  right: TerminalSettingsDto
) {
  return Object.entries(left).some(
    ([key, value]) => value !== right[key as keyof TerminalSettingsDto]
  );
}

export function normalizeTerminalSettings(
  settings: TerminalSettingsDto
): TerminalSettingsDto {
  return {
    ...settings,
    fontSize: Math.round(clamp(settings.fontSize, 8, 48)),
    fontWeight: Math.round(clamp(settings.fontWeight, 100, 900) / 100) * 100,
    fontWeightBold: Math.round(clamp(settings.fontWeightBold, 100, 900) / 100) * 100,
    lineHeight: clamp(settings.lineHeight, 1, 2),
    letterSpacing: clamp(settings.letterSpacing, -1, 1),
    scrollback: Math.round(clamp(settings.scrollback, 100, 1_000_000))
  };
}
