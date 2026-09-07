import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  DeleteTrustedHostKeyInput,
  DeleteTrustedHostKeyResult,
  SshConnectInput,
  SshConnectResult,
  SshDataEvent,
  SshDisconnectInput,
  SshResizeInput,
  SshWriteInput,
  SshOutputAckInput,
  TrustHostKeyInput,
  TrustedHostKey
} from "../../types/ssh";
import { normalizeAppError } from "../../types/errors";

export async function sshAckOutput(input: SshOutputAckInput): Promise<void> {
  await invoke("ssh_ack_output", { input });
}

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

export async function sshTrustHostKey(input: TrustHostKeyInput): Promise<void> {
  try {
    await invoke("ssh_trust_host_key", { input });
  } catch (error) {
    throw normalizeAppError(error);
  }
}

export async function listTrustedHostKeys(): Promise<TrustedHostKey[]> {
  try {
    return await invoke<TrustedHostKey[]>("ssh_list_trusted_host_keys");
  } catch (error) {
    throw normalizeAppError(error);
  }
}

export async function deleteTrustedHostKey(
  input: DeleteTrustedHostKeyInput
): Promise<DeleteTrustedHostKeyResult> {
  try {
    return await invoke<DeleteTrustedHostKeyResult>("ssh_delete_trusted_host_key", { input });
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
