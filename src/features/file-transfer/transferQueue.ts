import type { TransferTask } from "../../types/fileTransfer";

export function formatTransferBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${Math.round(value)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2)} ${units[index]}`;
}

export function transferPercent(
  task: Pick<TransferTask, "status" | "transferredBytes" | "totalBytes">
) {
  if (task.totalBytes > 0) {
    return Math.min(100, Math.max(0, task.transferredBytes / task.totalBytes * 100));
  }
  return task.status === "completed" ? 100 : 0;
}

export function averageTransferSpeed(
  task: Pick<TransferTask, "status" | "startedAt" | "transferredBytes">,
  now = Date.now()
) {
  if (task.status !== "running" || !task.startedAt || task.transferredBytes <= 0) {
    return undefined;
  }
  const seconds = Math.max(0.5, (now - task.startedAt) / 1000);
  return task.transferredBytes / seconds;
}
