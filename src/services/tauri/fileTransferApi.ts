import { Channel, invoke } from "@tauri-apps/api/core";
import { getCurrentWebview, type DragDropEvent } from "@tauri-apps/api/webview";
import { lstat } from "@tauri-apps/plugin-fs";
import type {
  DeleteRemotePathInput,
  OpenRemoteFileInput,
  RenameRemotePathInput,
  DownloadRemotePathInput,
  ListRemoteDirectoryInput,
  ListRemoteDirectoryResult,
  CloseFileTransferSessionInput,
  OpenFileTransferSessionInput,
  OpenFileTransferSessionResult,
  TransferProgress,
  TransferTask,
  UploadRemoteDirectoryInput,
  UploadRemoteFileInput
} from "../../types/fileTransfer";
import { normalizeAppError } from "../../types/errors";

export async function renameRemotePath(input: RenameRemotePathInput): Promise<string> {
  try {
    return await invoke<string>("ssh_rename_remote_path", { input });
  } catch (error) {
    throw normalizeAppError(error);
  }
}

export async function openRemoteFile(input: OpenRemoteFileInput): Promise<void> {
  try {
    await invoke<void>("ssh_open_remote_file", { input });
  } catch (error) {
    throw normalizeAppError(error);
  }
}

export async function deleteRemotePath(input: DeleteRemotePathInput): Promise<void> {
  try {
    await invoke<void>("ssh_delete_remote_path", { input });
  } catch (error) {
    throw normalizeAppError(error);
  }
}

export function listenFileDrop(handler: (event: DragDropEvent) => void) {
  return getCurrentWebview().onDragDropEvent((event) => handler(event.payload));
}

export async function localUploadKind(path: string): Promise<"file" | "directory"> {
  const info = await lstat(path);
  if (info.isSymlink || (!info.isFile && !info.isDirectory)) {
    throw new Error("仅支持普通文件或文件夹");
  }
  return info.isDirectory ? "directory" : "file";
}

export async function openFileTransferSession(
  input: OpenFileTransferSessionInput
): Promise<OpenFileTransferSessionResult> {
  try {
    return await invoke<OpenFileTransferSessionResult>("ssh_open_file_transfer_session", { input });
  } catch (error) {
    throw normalizeAppError(error);
  }
}

export async function closeFileTransferSession(input: CloseFileTransferSessionInput): Promise<void> {
  try {
    await invoke("ssh_close_file_transfer_session", { input });
  } catch (error) {
    throw normalizeAppError(error);
  }
}

export async function listRemoteDirectory(
  input: ListRemoteDirectoryInput
): Promise<ListRemoteDirectoryResult> {
  try {
    return await invoke<ListRemoteDirectoryResult>("ssh_list_remote_directory", { input });
  } catch (error) {
    throw normalizeAppError(error);
  }
}

export async function enqueueUploadRemoteFile(
  input: UploadRemoteFileInput,
  onProgress: Channel<TransferProgress>
): Promise<TransferTask> {
  try {
    return await invoke<TransferTask>("ssh_enqueue_upload_remote_file", { input, onProgress });
  } catch (error) {
    throw normalizeAppError(error);
  }
}

export async function enqueueUploadRemoteDirectory(
  input: UploadRemoteDirectoryInput,
  onProgress: Channel<TransferProgress>
): Promise<TransferTask> {
  try {
    return await invoke<TransferTask>("ssh_enqueue_upload_remote_directory", { input, onProgress });
  } catch (error) {
    throw normalizeAppError(error);
  }
}

export async function enqueueDownloadRemotePath(
  input: DownloadRemotePathInput,
  onProgress: Channel<TransferProgress>
): Promise<TransferTask> {
  try {
    return await invoke<TransferTask>("ssh_enqueue_download_remote_path", { input, onProgress });
  } catch (error) {
    throw normalizeAppError(error);
  }
}

export async function listTransferTasks(): Promise<TransferTask[]> {
  try {
    return await invoke<TransferTask[]>("ssh_list_transfer_tasks");
  } catch (error) {
    throw normalizeAppError(error);
  }
}

export async function getTransferTask(transferId: string): Promise<TransferTask> {
  try {
    return await invoke<TransferTask>("ssh_get_transfer_task", { input: { transferId } });
  } catch (error) {
    throw normalizeAppError(error);
  }
}

export async function cancelTransfer(transferId: string): Promise<TransferTask> {
  try {
    return await invoke<TransferTask>("ssh_cancel_transfer", { input: { transferId } });
  } catch (error) {
    throw normalizeAppError(error);
  }
}

export async function deleteTransferTask(transferId: string): Promise<void> {
  try {
    await invoke<void>("ssh_delete_transfer_task", { input: { transferId } });
  } catch (error) {
    throw normalizeAppError(error);
  }
}
