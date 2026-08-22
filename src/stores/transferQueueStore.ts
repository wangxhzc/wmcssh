import { create } from "zustand";
import { cancelTransfer, listTransferTasks } from "../services/tauri/fileTransferApi";
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

export const useTransferQueueStore = create<TransferQueueStore>((set, get) => ({
  tasks: [],
  loading: false,
  loaded: false,

  async loadTasks() {
    if (get().loading) return;
    set({ loading: true, error: undefined });
    try {
      set({ tasks: await listTransferTasks(), loaded: true });
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
  }
}));
