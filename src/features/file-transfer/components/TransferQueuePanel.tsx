import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import { TransferQueue } from "./TransferQueue";

export function TransferQueuePanel({ id, transferSessionId, height, onHeightChange: setHeight }: {
  id: string;
  transferSessionId?: string;
  height: number;
  onHeightChange: Dispatch<SetStateAction<number>>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; y: number; height: number } | null>(null);
  const [maximum, setMaximum] = useState(360);
  const minimum = Math.min(90, maximum);
  const resize = (value: number) => setHeight(Math.round(Math.max(minimum, Math.min(maximum, value))));

  useEffect(() => {
    const parent = panelRef.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(() => {
      if (!parent.clientHeight) return;
      const max = Math.max(60, Math.floor(parent.clientHeight * 0.6));
      setMaximum(max);
      setHeight((current) => Math.min(current, max));
    });
    const stop = () => { drag.current = null; };
    observer.observe(parent);
    window.addEventListener("blur", stop);
    return () => {
      observer.disconnect();
      window.removeEventListener("blur", stop);
    };
  }, [setHeight]);

  return (
    <div id={id} ref={panelRef} className="file-transfer-queue-panel" style={{ height }}>
      <div className="transfer-queue-resize-handle" role="separator" tabIndex={0}
        aria-label="调整传输队列高度" aria-orientation="horizontal"
        aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={height}
        title="拖动调整高度，双击恢复默认"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { pointerId: event.pointerId, y: event.clientY, height };
        }}
        onPointerMove={(event) => {
          if (drag.current?.pointerId === event.pointerId) resize(drag.current.height + drag.current.y - event.clientY);
        }}
        onPointerUp={(event) => {
          drag.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => { drag.current = null; }}
        onLostPointerCapture={() => { drag.current = null; }}
        onDoubleClick={() => resize(180)}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") resize(height + 10);
          else if (event.key === "ArrowDown") resize(height - 10);
          else if (event.key === "Home") resize(minimum);
          else if (event.key === "End") resize(maximum);
          else return;
          event.preventDefault();
        }} />
      <TransferQueue transferSessionId={transferSessionId} compact />
    </div>
  );
}
