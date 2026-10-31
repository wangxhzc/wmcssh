import type { EpochMillis, HostId, SessionId } from "./common";
import type { AppErrorDto } from "./errors";
import type { AuthType } from "./host";

export type SessionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "closing"
  | "error";

export type SshConnectInput = {
  sessionId?: SessionId;
  hostId: HostId;
  initialCols: number;
  initialRows: number;
  username?: string;
  authType?: AuthType;
  password?: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
};

export type SshConnectResult = {
  sessionId: SessionId;
};

export type SshWriteInput = {
  sessionId: SessionId;
  dataBase64: string;
};

export type SshOutputAckInput = { sessionId: SessionId; bytes: number };

export type SshResizeInput = {
  sessionId: SessionId;
  cols: number;
  rows: number;
};

export type SshDisconnectInput = {
  sessionId: SessionId;
};

export type TrustHostKeyInput = {
  hostId: HostId;
  expectedFingerprint: string;
};

export type HostKeyChallenge = {
  hostname: string;
  port: number;
  keyType: string;
  fingerprint: string;
  changed: boolean;
};

export type TrustedHostKey = {
  id: string;
  hostPatterns: string;
  hostname?: string;
  port?: number;
  keyType: string;
  fingerprint: string;
  hashed: boolean;
  marker?: string;
};

export type DeleteTrustedHostKeyInput = {
  id: string;
};

export type DeleteTrustedHostKeyResult = {
  deleted: boolean;
};

export type SshDataEvent = {
  event: "data";
  data: {
    sessionId: SessionId;
    dataBase64: string;
  };
};

export type SshStatusPayload = {
  sessionId: SessionId;
  hostId: HostId;
  status: SessionStatus;
  message?: string;
  at: EpochMillis;
};

export type SshClosedPayload = {
  sessionId: SessionId;
  hostId: HostId;
  reason:
    | "user_disconnect"
    | "remote_closed"
    | "network_error"
    | "worker_error"
    | "unknown";
  message?: string;
  at: EpochMillis;
};

export type SshErrorPayload = {
  sessionId: SessionId;
  hostId?: HostId;
  error: AppErrorDto;
  at: EpochMillis;
};

export const SSH_EVENTS = {
  status: "ssh:status",
  closed: "ssh:closed",
  error: "ssh:error"
} as const;
