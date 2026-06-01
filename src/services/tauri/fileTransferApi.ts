import { invoke } from "@tauri-apps/api/core";
import type {
  DownloadRemoteFileInput,
  DownloadRemoteFileResult,
  DownloadRemotePathInput,
  DownloadRemotePathResult,
  ListRemoteDirectoryInput,
  ListRemoteDirectoryResult,
  CloseFileTransferSessionInput,
  OpenFileTransferSessionInput,
  OpenFileTransferSessionResult,
  UploadRemoteDirectoryInput,
  UploadRemoteFileInput
} from "../../types/fileTransfer";
import { normalizeAppError } from "../../types/errors";

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

export async function uploadRemoteFile(input: UploadRemoteFileInput): Promise<void> {
  try {
    await invoke("ssh_upload_remote_file", { input });
  } catch (error) {
    throw normalizeAppError(error);
  }
}

export async function uploadRemoteDirectory(input: UploadRemoteDirectoryInput): Promise<void> {
  try {
    await invoke("ssh_upload_remote_directory", { input });
  } catch (error) {
    throw normalizeAppError(error);
  }
}

export async function downloadRemoteFile(
  input: DownloadRemoteFileInput
): Promise<DownloadRemoteFileResult> {
  try {
    return await invoke<DownloadRemoteFileResult>("ssh_download_remote_file", { input });
  } catch (error) {
    throw normalizeAppError(error);
  }
}

export async function downloadRemotePath(
  input: DownloadRemotePathInput
): Promise<DownloadRemotePathResult> {
  try {
    return await invoke<DownloadRemotePathResult>("ssh_download_remote_path", { input });
  } catch (error) {
    throw normalizeAppError(error);
  }
}
