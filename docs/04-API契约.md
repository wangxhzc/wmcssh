# API 契约

## 1. 通用约定

- 前端 TypeScript 字段：`camelCase`
- Rust 结构体字段：`snake_case`
- Rust 对外序列化：`#[serde(rename_all = "camelCase")]`
- command 名称：`snake_case`
- 时间：`epoch milliseconds`

## 2. Host Commands

```ts
list_hosts(filter?): Promise<{ hosts: HostDto[] }>
create_host(input): Promise<HostDto>
update_host(hostId, input): Promise<HostDto>
delete_host(hostId): Promise<void>
get_host(hostId): Promise<HostDto>
```

当前 `HostDto` 关键字段：

```ts
type HostDto = {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  authType: "password" | "private_key";
  hasPassword: boolean;
  privateKeyPath?: string;
  hasPassphrase: boolean;
  connectTimeoutMs: number;
  keepaliveIntervalSecs: number;
  startupCommand?: string;
  terminalTheme?: string;
  lastConnectedAt?: number;
  lastStatus?: string;
  lastErrorMessage?: string;
  createdAt: number;
  updatedAt: number;
};
```

## 3. SSH Commands

```ts
type SshConnectInput = {
  hostId: string;
  initialCols: number;
  initialRows: number;
};

type SshConnectResult = {
  sessionId: string;
};

type SshWriteInput = {
  sessionId: string;
  dataBase64: string;
};

type SshResizeInput = {
  sessionId: string;
  cols: number;
  rows: number;
};

type SshDisconnectInput = {
  sessionId: string;
};
```

命令：

```text
ssh_connect(input, onData)
ssh_write(input)
ssh_resize(input)
ssh_disconnect(input)
```

## 4. SSH Events

```ts
type SessionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "closing"
  | "error";
```

```ts
type SshStatusPayload = {
  sessionId: string;
  hostId: string;
  status: SessionStatus;
  message?: string;
  at: number;
};
```

```ts
type SshClosedPayload = {
  sessionId: string;
  hostId: string;
  reason: "user_disconnect" | "remote_closed" | "network_error" | "worker_error" | "unknown";
  message?: string;
  at: number;
};
```

```ts
type SshErrorPayload = {
  sessionId: string;
  hostId?: string;
  error: AppErrorDto;
  at: number;
};
```

事件名：

```text
ssh:status
ssh:closed
ssh:error
```

## 5. SSH 数据流

```ts
type SshDataEvent = {
  event: "data";
  data: {
    sessionId: string;
    dataBase64: string;
  };
};
```

## 6. File Transfer Commands

```ts
type ListRemoteDirectoryInput = {
  hostId: string;
  path?: string;
};

type ListRemoteDirectoryResult = {
  hostId: string;
  path: string;
  entries: RemoteFileEntry[];
  fallbackToRoot: boolean;
};
```

```ts
type RemoteFileEntry = {
  name: string;
  path: string;
  entryType: "directory" | "file" | "symlink" | "other";
  size?: number;
  modifiedAt?: number;
};
```

```ts
type UploadRemoteFileInput = {
  hostId: string;
  remoteDirPath: string;
  fileName: string;
  contentBase64: string;
};

type DownloadRemoteFileInput = {
  hostId: string;
  remoteFilePath: string;
};

type DownloadRemoteFileResult = {
  fileName: string;
  contentBase64: string;
};
```

命令：

```text
ssh_list_remote_directory(input)
ssh_upload_remote_file(input)
ssh_download_remote_file(input)
```

## 7. Settings / Recent

```ts
get_terminal_settings(): Promise<TerminalSettingsDto>
update_terminal_settings(input): Promise<TerminalSettingsDto>
reset_terminal_settings(): Promise<TerminalSettingsDto>
list_recent_sessions(input?): Promise<ListRecentSessionsResult>
```

## 8. 错误模型

```ts
type AppErrorDto = {
  code:
    | "host_not_found"
    | "host_invalid"
    | "secret_not_found"
    | "secret_store_error"
    | "auth_failed"
    | "network_unreachable"
    | "timeout"
    | "session_not_found"
    | "session_closed"
    | "input_buffer_full"
    | "io_error"
    | "database_error"
    | "unsupported"
    | "unknown";
  message: string;
  details?: string;
  retryable: boolean;
};
```

## 9. 敏感字段规则

密码和私钥口令只允许出现在：

- `CreateHostInput`
- `UpdateHostInput`
- Rust 服务层读 SecretStore 后的运行时配置

不允许出现在：

- `HostDto`
- `RecentSessionDto`
- 前端状态持久化
- 普通日志
