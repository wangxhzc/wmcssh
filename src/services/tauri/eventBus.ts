import { listen } from "@tauri-apps/api/event";
import type { SshClosedPayload, SshErrorPayload, SshStatusPayload } from "../../types/ssh";
import { SSH_EVENTS } from "../../types/ssh";

export async function listenSshStatus(handler: (payload: SshStatusPayload) => void) {
  return listen<SshStatusPayload>(SSH_EVENTS.status, (event) => handler(event.payload));
}

export async function listenSshClosed(handler: (payload: SshClosedPayload) => void) {
  return listen<SshClosedPayload>(SSH_EVENTS.closed, (event) => handler(event.payload));
}

export async function listenSshError(handler: (payload: SshErrorPayload) => void) {
  return listen<SshErrorPayload>(SSH_EVENTS.error, (event) => handler(event.payload));
}
