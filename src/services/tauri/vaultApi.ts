import { invoke } from "@tauri-apps/api/core";
import { normalizeAppError } from "../../types/errors";
import type { VaultStatusResult } from "../../types/vault";

export async function getVaultStatus(): Promise<VaultStatusResult> {
  try { return await invoke<VaultStatusResult>("get_vault_status"); }
  catch (error) { throw normalizeAppError(error); }
}

export async function initializeVault(password: string): Promise<void> {
  try { await invoke("initialize_vault", { input: { password } }); }
  catch (error) { throw normalizeAppError(error); }
}

export async function unlockVault(password: string): Promise<void> {
  try { await invoke("unlock_vault", { input: { password } }); }
  catch (error) { throw normalizeAppError(error); }
}
