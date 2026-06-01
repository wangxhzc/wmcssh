import type { EpochMillis, GroupId, HostId, TagId } from "./common";

export type AuthType = "password" | "private_key";

export type ConnectionStatus =
  | "connected"
  | "disconnected"
  | "failed"
  | "auth_failed"
  | "timeout"
  | "network_error";

export type TagDto = {
  id: TagId;
  name: string;
  color?: string;
  createdAt: EpochMillis;
  updatedAt: EpochMillis;
};

export type HostGroupDto = {
  id: GroupId;
  name: string;
  parentId?: GroupId;
  sortOrder: number;
  createdAt: EpochMillis;
  updatedAt: EpochMillis;
};

export type HostDto = {
  id: HostId;
  name: string;
  hostname: string;
  port: number;
  username: string;
  authType: AuthType;
  hasPassword: boolean;
  privateKeyPath?: string;
  hasPassphrase: boolean;
  groupId?: GroupId;
  tags: TagDto[];
  connectTimeoutMs: number;
  keepaliveIntervalSecs: number;
  startupCommand?: string;
  terminalTheme?: string;
  lastConnectedAt?: EpochMillis;
  lastStatus?: ConnectionStatus;
  lastErrorMessage?: string;
  createdAt: EpochMillis;
  updatedAt: EpochMillis;
};

export type SecretUpdate =
  | { action: "keep" }
  | { action: "replace"; value: string }
  | { action: "clear" };

export type CreateHostInput = {
  name: string;
  hostname: string;
  port: number;
  username: string;
  authType: AuthType;
  password?: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
  groupId?: GroupId;
  tagIds?: TagId[];
  connectTimeoutMs?: number;
  keepaliveIntervalSecs?: number;
  startupCommand?: string;
  terminalTheme?: string;
};

export type UpdateHostInput = {
  name?: string;
  hostname?: string;
  port?: number;
  username?: string;
  authType?: AuthType;
  password?: SecretUpdate;
  privateKeyPath?: string;
  privateKeyPassphrase?: SecretUpdate;
  groupId?: GroupId | null;
  tagIds?: TagId[];
  connectTimeoutMs?: number;
  keepaliveIntervalSecs?: number;
  startupCommand?: string | null;
  terminalTheme?: string | null;
};

export type DuplicateHostInput = {
  hostId: HostId;
  name: string;
};

export type HostFilter = {
  keyword?: string;
  groupId?: GroupId;
  tagIds?: TagId[];
  authType?: AuthType;
  recentlyConnected?: boolean;
};

export type HostListResult = {
  hosts: HostDto[];
};
