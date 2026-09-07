import { getCurrentWindow } from "@tauri-apps/api/window";

/** Request normal window closure, preserving the backend transfer confirmation. */
export async function closeAppWindow(): Promise<void> {
  await getCurrentWindow().close();
}
