import type { HostId, SessionId } from "./common";
import type { AppErrorDto } from "./errors";

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
  transferSessionId: SessionId;
  remoteDirPath: string;
  fileName: string;
  contentBase64: string;
};

export type RemoteDirectoryFilePayload = {
  relativePath: string;
  contentBase64: string;
};

export type UploadRemoteDirectoryInput = {
  transferSessionId: SessionId;
  remoteDirPath: string;
  directoryName: string;
  directories: string[];
  files: RemoteDirectoryFilePayload[];
};

export type DownloadRemoteFileInput = {
  transferSessionId: SessionId;
  remoteFilePath: string;
};

export type DownloadRemoteFileResult = {
  fileName: string;
  contentBase64: string;
};

export type DownloadRemotePathInput = {
  transferSessionId: SessionId;
  remotePath: string;
};

export type DownloadRemotePathResult = {
  name: string;
  entryType: RemoteFileEntryType;
  contentBase64?: string;
  directories: string[];
  files: RemoteDirectoryFilePayload[];
};

export type OpenFileTransferSessionInput = {
  hostId: HostId;
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
