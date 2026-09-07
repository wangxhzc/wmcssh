import { invoke } from "@tauri-apps/api/core";
export { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

export async function readPrimarySelection(): Promise<string | null> {
  return invoke<string | null>("read_primary_selection");
}

export async function writePrimarySelection(text: string): Promise<void> {
  await invoke("write_primary_selection", { text });
}
