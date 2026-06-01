import type { EpochMillis, HostId, SessionId } from "./common";
import type { AppErrorDto } from "./errors";

export type SessionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "closing"
  | "error";

export type SshConnectInput = {
  hostId: HostId;
  initialCols: number;
  initialRows: number;
};

export type SshConnectResult = {
  sessionId: SessionId;
};

export type SshWriteInput = {
  sessionId: SessionId;
  dataBase64: string;
};

export type SshResizeInput = {
  sessionId: SessionId;
  cols: number;
  rows: number;
};

export type SshDisconnectInput = {
  sessionId: SessionId;
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
