import type { HostId, SessionId } from "./common";
import type { AppErrorDto } from "./errors";
import type { AuthType } from "./host";

export type RemoteFileEntryType = "directory" | "file" | "symlink" | "other";

export type RemoteFileEntry = {
  name: string;
  path: string;
  entryType: RemoteFileEntryType;
  size?: number;
  modifiedAt?: number;
};

export type ListRemoteDirectoryInput = {
  transferSessionId: SessionId;
  path?: string;
};

export type ListRemoteDirectoryResult = {
  hostId: HostId;
  path: string;
  entries: RemoteFileEntry[];
  fallbackToRoot: boolean;
};

export type UploadRemoteFileInput = {
  transferId: string;
  transferSessionId: SessionId;
  remoteDirPath: string;
  fileName: string;
  localFilePath: string;
};

export type UploadRemoteDirectoryFilePayload = {
  relativePath: string;
  localFilePath: string;
};

export type UploadRemoteDirectoryInput = {
  transferId: string;
  transferSessionId: SessionId;
  remoteDirPath: string;
  directoryName: string;
  directories: string[];
  files: UploadRemoteDirectoryFilePayload[];
};

export type TransferDirection = "upload" | "download";

export type TransferStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type TransferProgress = {
  transferId: string;
  status: TransferStatus;
  transferredBytes: number;
  totalBytes: number;
  currentFile: string | null;
  completedFiles: number;
  totalFiles: number;
};

export type DownloadRemotePathInput = {
  transferId: string;
  transferSessionId: SessionId;
  remotePath: string;
  localPath: string;
};

export type TransferTask = {
  transferId: string;
  transferSessionId: SessionId;
  direction: TransferDirection;
  status: TransferStatus;
  sourcePath: string;
  destinationPath: string;
  transferredBytes: number;
  totalBytes: number;
  currentFile: string | null;
  completedFiles: number;
  totalFiles: number;
  error: AppErrorDto | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
};

export type OpenFileTransferSessionInput = {
  hostId: HostId;
  username?: string;
  authType?: AuthType;
  password?: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
};

export type OpenFileTransferSessionResult = {
  transferSessionId: SessionId;
};

export type CloseFileTransferSessionInput = {
  transferSessionId: SessionId;
};

export type FileTransferLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; path: string; entries: RemoteFileEntry[]; fallbackToRoot: boolean }
  | { status: "error"; error: AppErrorDto };
