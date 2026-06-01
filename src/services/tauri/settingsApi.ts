import { invoke } from "@tauri-apps/api/core";
import type { TerminalSettingsDto } from "../../types/settings";
import { defaultTerminalSettings } from "../../types/settings";
import { normalizeAppError } from "../../types/errors";

export async function getTerminalSettings(): Promise<TerminalSettingsDto> {
  try {
    return await invoke<TerminalSettingsDto>("get_terminal_settings");
  } catch (error) {
    throw normalizeAppError(error);
  }
}

export async function updateTerminalSettings(
  input: TerminalSettingsDto
): Promise<TerminalSettingsDto> {
  try {
    return await invoke<TerminalSettingsDto>("update_terminal_settings", { input });
  } catch (error) {
    throw normalizeAppError(error);
  }
}

export async function resetTerminalSettings(): Promise<TerminalSettingsDto> {
  try {
    return await invoke<TerminalSettingsDto>("reset_terminal_settings");
  } catch (error) {
    throw normalizeAppError(error);
  }
}

export function cloneDefaultTerminalSettings(): TerminalSettingsDto {
  return { ...defaultTerminalSettings };
}
