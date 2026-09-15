import { create } from "zustand";
import { cancelTransfer, deleteTransferTask, listTransferTasks } from "../services/tauri/fileTransferApi";
import type { TransferProgress, TransferTask } from "../types/fileTransfer";

type TransferQueueStore = {
  tasks: TransferTask[];
  loading: boolean;
  loaded: boolean;
  error?: string;
  loadTasks: () => Promise<void>;
  upsertTask: (task: TransferTask) => void;
  applyProgress: (progress: TransferProgress) => void;
  cancelTask: (transferId: string) => Promise<void>;
  deleteTask: (transferId: string) => Promise<void>;
};

function messageFromError(cause: unknown) {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    return String(cause.message);
  }
  return String(cause);
}

function upsert(tasks: TransferTask[], task: TransferTask) {
  const index = tasks.findIndex((candidate) => candidate.transferId === task.transferId);
  if (index < 0) return [task, ...tasks];
  const next = [...tasks];
  next[index] = task;
  return next;
}

let deletionVersion = 0;

export const useTransferQueueStore = create<TransferQueueStore>((set, get) => ({
  tasks: [],
  loading: false,
  loaded: false,

  async loadTasks() {
    if (get().loading) return;
    set({ loading: true, error: undefined });
    const version = deletionVersion;
    try {
      const tasks = await listTransferTasks();
      if (version === deletionVersion) set({ tasks, loaded: true });
    } catch (cause) {
      set({ error: messageFromError(cause) });
    } finally {
      set({ loading: false });
    }
  },

  upsertTask(task) {
    set((state) => ({ tasks: upsert(state.tasks, task), loaded: true }));
  },

  applyProgress(progress) {
    set((state) => ({
      tasks: state.tasks.map((task) => task.transferId === progress.transferId
        ? {
            ...task,
            status: progress.status,
            transferredBytes: progress.transferredBytes,
            totalBytes: progress.totalBytes,
            currentFile: progress.currentFile,
            completedFiles: progress.completedFiles,
            totalFiles: progress.totalFiles
          }
        : task)
    }));
  },

  async cancelTask(transferId) {
    set({ error: undefined });
    try {
      const task = await cancelTransfer(transferId);
      set((state) => ({ tasks: upsert(state.tasks, task) }));
    } catch (cause) {
      set({ error: messageFromError(cause) });
      throw cause;
    }
  },

  async deleteTask(transferId) {
    set({ error: undefined });
    try {
      await deleteTransferTask(transferId);
      deletionVersion += 1;
      set((state) => ({ tasks: state.tasks.filter((task) => task.transferId !== transferId) }));
    } catch (cause) {
      set({ error: messageFromError(cause) });
      throw cause;
    }
  }
}));
