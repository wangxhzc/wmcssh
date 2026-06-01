import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  SshConnectInput,
  SshConnectResult,
  SshDataEvent,
  SshDisconnectInput,
  SshResizeInput,
  SshWriteInput
} from "../../types/ssh";
import { normalizeAppError } from "../../types/errors";

export async function sshConnect(
  input: SshConnectInput,
  onData: Channel<SshDataEvent>
): Promise<SshConnectResult> {
  try {
    return await invoke<SshConnectResult>("ssh_connect", { input, onData });
  } catch (error) {
    throw normalizeAppError(error);
  }
}

export async function sshWrite(input: SshWriteInput): Promise<void> {
  try {
    await invoke("ssh_write", { input });
  } catch (error) {
    throw normalizeAppError(error);
  }
}

export async function sshResize(input: SshResizeInput): Promise<void> {
  try {
    await invoke("ssh_resize", { input });
  } catch (error) {
    throw normalizeAppError(error);
  }
}

export async function sshDisconnect(input: SshDisconnectInput): Promise<void> {
  try {
    await invoke("ssh_disconnect", { input });
  } catch (error) {
    throw normalizeAppError(error);
  }
}
