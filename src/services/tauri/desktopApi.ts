import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";

export async function openWebLink(url: string): Promise<void> {
  await invoke("open_web_link", { url });
}

export async function requestTerminalAttention(): Promise<void> {
  await getCurrentWindow().requestUserAttention(UserAttentionType.Informational);
}
