import { useEffect, useMemo, useState } from "react";
import { useTransferQueueStore } from "../../../stores/transferQueueStore";
import type { TransferStatus } from "../../../types/fileTransfer";
import { averageTransferSpeed, formatTransferBytes, transferPercent } from "../transferQueue";

type TransferQueueProps = {
  transferSessionId?: string;
  compact?: boolean;
};

const statusLabels: Record<TransferStatus, string> = {
  queued: "等待中",
  running: "传输中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消"
};

function formatTaskTime(timestamp: number | null) {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

export function TransferQueue({ transferSessionId, compact = false }: TransferQueueProps) {
  const tasks = useTransferQueueStore((state) => state.tasks);
  const loading = useTransferQueueStore((state) => state.loading);
  const loaded = useTransferQueueStore((state) => state.loaded);
  const error = useTransferQueueStore((state) => state.error);
  const loadTasks = useTransferQueueStore((state) => state.loadTasks);
  const cancelTask = useTransferQueueStore((state) => state.cancelTask);
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(() => new Set());
  const visibleTasks = useMemo(() => tasks
    .filter((task) => !transferSessionId || task.transferSessionId === transferSessionId)
    .sort((left, right) => right.createdAt - left.createdAt), [tasks, transferSessionId]);

  useEffect(() => {
    void loadTasks();
    const timer = window.setInterval(() => void loadTasks(), 1000);
    return () => window.clearInterval(timer);
  }, [loadTasks]);

  const requestCancel = async (transferId: string) => {
    setCancellingIds((ids) => new Set(ids).add(transferId));
    try {
      await cancelTask(transferId);
    } catch {
      // The shared store exposes the actionable backend error in this panel.
    } finally {
      setCancellingIds((ids) => {
        const next = new Set(ids);
        next.delete(transferId);
        return next;
      });
    }
  };

  return (
    <div className={`transfer-queue${compact ? " compact" : ""}`}>
      <div className="transfer-queue-toolbar">
        <span>
          {visibleTasks.length > 0
            ? `${visibleTasks.filter((task) => task.status === "running" || task.status === "queued").length} 个进行中 · ${visibleTasks.length} 个任务`
            : "传输任务"}
        </span>
        <button type="button" className="ghost-button" disabled={loading} onClick={() => void loadTasks()}>
          {loading ? "刷新中..." : "刷新"}
        </button>
      </div>

      {error ? <div className="transfer-queue-error">传输队列操作失败：{error}</div> : null}
      {!loaded && loading ? <div className="transfer-queue-empty">正在读取后台传输任务...</div> : null}
      {loaded && visibleTasks.length === 0 ? (
        <div className="transfer-queue-empty">
          <strong>暂无后台传输任务</strong>
          <span>上传或下载后，任务进度会显示在这里；关闭文件标签不会中断任务。</span>
        </div>
      ) : null}

      <div className="transfer-task-list">
        {visibleTasks.map((task) => {
          const cancellable = task.status === "queued" || task.status === "running";
          const cancelling = cancellingIds.has(task.transferId);
          const percent = transferPercent(task);
          const speed = averageTransferSpeed(task);
          return (
            <article key={task.transferId} className={`transfer-task ${task.status}`}>
              <div className="transfer-task-heading">
                <div>
                  <span className={`transfer-status ${task.status}`}>{statusLabels[task.status]}</span>
                  <strong>{task.direction === "upload" ? "上传" : "下载"}</strong>
                  <time>{formatTaskTime(task.createdAt)}</time>
                </div>
                {cancellable ? (
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={cancelling}
                    onClick={() => void requestCancel(task.transferId)}
                  >
                    {cancelling ? "取消中..." : "取消"}
                  </button>
                ) : null}
              </div>
              <div className="transfer-task-paths">
                <span title={task.sourcePath}>{task.sourcePath}</span>
                <span aria-hidden="true">→</span>
                <span title={task.destinationPath}>{task.destinationPath}</span>
              </div>
              <div
                className="transfer-progress-track"
                role="progressbar"
                aria-label={`${task.direction === "upload" ? "上传" : "下载"}进度`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={task.totalBytes > 0 || task.status === "completed" ? Math.round(percent) : undefined}
              >
                <div
                  className={`transfer-progress-fill${task.status === "running" && task.totalBytes === 0 ? " indeterminate" : ""}`}
                  style={task.totalBytes > 0 || task.status === "completed" ? { width: `${percent}%` } : undefined}
                />
              </div>
              <div className="transfer-task-meta">
                <span>
                  {formatTransferBytes(task.transferredBytes)} / {task.totalBytes > 0 ? formatTransferBytes(task.totalBytes) : "计算中"}
                  {speed ? ` · ${formatTransferBytes(speed)}/s` : ""}
                </span>
                <span title={task.currentFile ?? undefined}>
                  {task.currentFile
                    ? `${task.currentFile}${task.totalFiles > 1 ? ` · ${task.completedFiles} / ${task.totalFiles} 个文件` : ""}`
                    : task.totalFiles > 1 ? `${task.completedFiles} / ${task.totalFiles} 个文件` : `${percent.toFixed(0)}%`}
                </span>
              </div>
              {task.error ? <div className="transfer-task-error">{task.error.message}</div> : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
