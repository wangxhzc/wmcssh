import type { AppErrorDto } from "../../types/errors";
import type { HostKeyChallenge } from "../../types/ssh";

export function parseHostKeyChallenge(error: AppErrorDto): HostKeyChallenge | undefined {
  if (error.code !== "host_key_unknown" && error.code !== "host_key_mismatch") return undefined;
  if (!error.details) return undefined;
  try {
    const value = JSON.parse(error.details) as Partial<HostKeyChallenge>;
    if (
      typeof value.hostname !== "string"
      || typeof value.port !== "number"
      || typeof value.keyType !== "string"
      || typeof value.fingerprint !== "string"
      || typeof value.changed !== "boolean"
    ) return undefined;
    return value as HostKeyChallenge;
  } catch {
    return undefined;
  }
}
