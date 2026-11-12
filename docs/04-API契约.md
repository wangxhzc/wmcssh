# API 契约

## 通用约定

Rust 命令使用 `snake_case`，对外 DTO 使用 serde `camelCase` 序列化，
TypeScript 字段使用 `camelCase`。业务时间戳使用 epoch milliseconds；
文件修改时间等字段按具体契约处理。

完整字段以 [Rust contracts](../src-tauri/src/contracts/) 和
[TypeScript types](../src/types/) 为准，命令注册见
[lib.rs](../src-tauri/src/lib.rs)，调用封装见 [tauri services](../src/services/tauri/)。
下列签名描述 invoke 参数，省略后端注入的 `State` 与 `AppHandle`。

## 主机命令

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `list_hosts` | `filter?` | `HostListResult` |
| `get_host` | `hostId` | `HostDto` |
| `create_host` | `input: CreateHostInput` | `HostDto` |
| `update_host` | `hostId, input: UpdateHostInput` | `HostDto` |
| `duplicate_host` | `input: DuplicateHostInput` | `HostDto` |
| `move_host` | `input: MoveHostInput` | `void` |
| `delete_host` | `hostId` | `void` |

`HostDto` 包含连接配置、分组、标签、时间和连接摘要，通过 `hasPassword` 与
`hasPassphrase` 表示凭据存在情况。更新秘密值使用
`SecretUpdate` 的 `keep`、`replace`、`clear` 动作。

## SSH 命令与数据

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `ssh_connect` | `input: SshConnectInput, onData: Channel<SshDataEvent>` | `SshConnectResult` |
| `ssh_write` | `input: SshWriteInput` | `void` |
| `ssh_ack_output` | `input: SshOutputAckInput` | `void` |
| `ssh_resize` | `input: SshResizeInput` | `void` |
| `ssh_disconnect` | `input: SshDisconnectInput` | `void` |
| `ssh_trust_host_key` | `input: TrustHostKeyInput` | `void` |
| `ssh_list_trusted_host_keys` | 无 | `TrustedHostKey[]` |
| `ssh_delete_trusted_host_key` | `input: DeleteTrustedHostKeyInput` | `DeleteTrustedHostKeyResult` |

连接输入包含 `hostId`、初始行列数、可选 `sessionId` 和临时认证参数。
应用在连接前生成并绑定 ID，后端校验唯一性。临时参数包括用户名、认证类型、
密码、私钥路径和口令。

输出 Channel 的负载为：

```ts
type SshDataEvent = {
  event: "data";
  data: { sessionId: string; dataBase64: string };
};
```

前端解码并交给 xterm，解析完成后以 `{ sessionId, bytes }` 调用
`ssh_ack_output` 释放后端额度。输入使用 `{ sessionId, dataBase64 }`。

状态事件为 `ssh:status`、`ssh:error` 和 `ssh:closed`，携带会话标识和时间。
状态枚举为 `connecting`、`connected`、`reconnecting`、`disconnected`、
`closing`、`error`。错误事件附带 `AppErrorDto`，关闭事件附带原因和可选说明。

## 文件传输命令

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `ssh_open_file_transfer_session` | `input: OpenFileTransferSessionInput` | `OpenFileTransferSessionResult` |
| `ssh_close_file_transfer_session` | `input: CloseFileTransferSessionInput` | `void` |
| `ssh_list_remote_directory` | `input: ListRemoteDirectoryInput` | `ListRemoteDirectoryResult` |
| `ssh_rename_remote_path` | `input: RenameRemotePathInput` | 新路径字符串 |
| `ssh_delete_remote_path` | `input: DeleteRemotePathInput` | `void` |
| `ssh_open_remote_file` | `input: OpenRemoteFileInput` | `void` |
| `ssh_enqueue_upload_remote_file` | `input: UploadRemoteFileInput, onProgress` | `TransferTask` |
| `ssh_enqueue_upload_remote_directory` | `input: UploadRemoteDirectoryInput, onProgress` | `TransferTask` |
| `ssh_enqueue_download_remote_path` | `input: DownloadRemotePathInput, onProgress` | `TransferTask` |
| `ssh_list_transfer_tasks` | 无 | `TransferTask[]` |
| `ssh_get_transfer_task` | `input: { transferId }` | `TransferTask` |
| `ssh_cancel_transfer` | `input: { transferId }` | `TransferTask` |
| `ssh_delete_transfer_task` | `input: { transferId }` | `void` |
| `get_transfer_config` | 无 | `TransferConfig` |

打开会话返回 `transferSessionId`，目录与文件操作使用该标识。打开输入支持临时认证参数。
上传文件传入 `localFilePath`，上传目录传入目录列表和相对路径对应的本地文件路径；
下载传入 `remotePath` 和 `localPath`，文件内容由后端流式处理。

排队命令使用 `Channel<TransferProgress>`，进度包含任务 ID、状态、字节数、
当前文件及文件数量。任务状态为 `queued`、`running`、`completed`、
`failed`、`cancelled`。`TransferTask` 还包含会话 ID、方向、源与目标路径、
错误和时间。删除记录适用于已结束任务。

## 设置、近期会话与凭据库

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `get_terminal_settings` | 无 | `TerminalSettingsDto` |
| `update_terminal_settings` | `input: TerminalSettingsDto` | `TerminalSettingsDto` |
| `reset_terminal_settings` | 无 | `TerminalSettingsDto` |
| `list_recent_sessions` | `input?: ListRecentSessionsInput` | `ListRecentSessionsResult` |
| `get_app_info` | 无 | `AppInfoDto` |
| `get_vault_status` | 无 | `VaultStatusResult` |
| `initialize_vault` | `input: { password }` | `void` |
| `unlock_vault` | `input: { password }` | `void` |
| `lock_vault` | 无 | `void` |

终端设置覆盖字体、字号、字重、行高、字间距、光标闪烁、输出高亮和回滚行数。
应用信息返回契约版本、应用版本和当前系统用户名；界面按使用场景展示所需字段。

## 本地交互命令

`read_primary_selection` 返回文本或空值，`write_primary_selection(text)`
写入 Linux PRIMARY。`open_web_link(url)` 校验 HTTP(S) 地址后使用系统浏览器打开。
常规剪贴板、窗口和文件选择器使用对应 Tauri API 或插件封装。

## 错误与敏感字段

失败统一返回 `AppErrorDto`，包含 `code`、`message`、可选 `details` 和
`retryable`。错误码覆盖主机、凭据、认证、主机密钥、网络、超时、会话、
输入容量、I/O 和数据库等情况，完整枚举见
[errors.ts](../src/types/errors.ts)。

密码和私钥口令用于主机创建、凭据更新及临时连接输入；主密码用于凭据库初始化和解锁。
这些值在提交和认证流程中短暂使用，持久化时进入加密凭据库。
主机和近期会话 DTO、普通日志及前端持久化状态须保持秘密值隔离。
