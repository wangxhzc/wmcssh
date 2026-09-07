import { type PointerEvent as ReactPointerEvent, type RefObject, useEffect, useRef, useState } from "react";
import type { MoveHostInput } from "../../types/host";

type Drop = { targetHostId: string; after: boolean };
type Drag = { hostId: string; pointerId: number; x: number; y: number; startX: number; startY: number; active: boolean; element: HTMLElement };

export function useHostReorder(scrollRef: RefObject<HTMLElement | null>, onMove: (input: MoveHostInput) => Promise<void>) {
  const callback = useRef(onMove);
  callback.current = onMove;
  const drag = useRef<Drag | null>(null);
  const drop = useRef<Drop | null>(null);
  const suppressUntil = useRef(0);
  const pending = useRef(false);
  const [draggedId, setDraggedId] = useState<string>();
  const [destination, setDestination] = useState<Drop | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let frame = 0;
    const setDrop = (value: Drop | null) => {
      if (drop.current?.targetHostId === value?.targetHostId && drop.current?.after === value?.after) return;
      drop.current = value;
      setDestination(value);
    };
    const locate = () => {
      const current = drag.current;
      const scroller = scrollRef.current;
      if (!current?.active || !scroller) return;
      const bounds = scroller.getBoundingClientRect();
      if (current.x < bounds.left || current.x > bounds.right || current.y < bounds.top || current.y > bounds.bottom) {
        setDrop(null);
        return;
      }
      const card = document.elementFromPoint(current.x, current.y)?.closest<HTMLElement>("[data-host-id]");
      if (!card || !scroller.contains(card) || card.dataset.hostId === current.hostId) { setDrop(null); return; }
      const rect = card.getBoundingClientRect();
      setDrop({ targetHostId: card.dataset.hostId!, after: current.y > rect.top + rect.height / 2 });
    };
    let previousTime = 0;
    const tick = (time: number) => {
      const current = drag.current;
      const scroller = scrollRef.current;
      if (!current?.active || !scroller) return;
      const bounds = scroller.getBoundingClientRect();
      const elapsed = previousTime ? Math.min(32, time - previousTime) : 16;
      previousTime = time;
      if (current.x >= bounds.left && current.x <= bounds.right && current.y >= bounds.top && current.y <= bounds.bottom) {
        const edge = 36;
        const speed = current.y < bounds.top + edge ? -(bounds.top + edge - current.y) / edge
          : current.y > bounds.bottom - edge ? (current.y - bounds.bottom + edge) / edge : 0;
        scroller.scrollTop += speed * elapsed * 0.6;
      }
      locate();
      frame = requestAnimationFrame(tick);
    };
    const finish = (commit: boolean) => {
      const current = drag.current;
      if (!current) return;
      const target = drop.current;
      drag.current = null;
      cancelAnimationFrame(frame);
      previousTime = 0;
      if (current.active) suppressUntil.current = Date.now() + 400;
      if (current.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
      setDraggedId(undefined);
      setDrop(null);
      if (commit && current.active && target) {
        pending.current = true;
        setSaving(true);
        void callback.current({ hostId: current.hostId, ...target }).finally(() => {
          pending.current = false;
          setSaving(false);
        });
      }
    };
    const move = (event: PointerEvent) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      current.x = event.clientX; current.y = event.clientY;
      if (!current.active && Math.hypot(current.x - current.startX, current.y - current.startY) >= 6) {
        current.active = true;
        current.element.setPointerCapture(current.pointerId);
        setDraggedId(current.hostId);
        frame = requestAnimationFrame(tick);
      }
      if (current.active) { event.preventDefault(); locate(); }
    };
    const up = (event: PointerEvent) => {
      if (drag.current?.pointerId !== event.pointerId) return;
      if (drag.current.active) { drag.current.x = event.clientX; drag.current.y = event.clientY; locate(); }
      finish(true);
    };
    const cancel = () => finish(false);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && drag.current) { event.preventDefault(); cancel(); }
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key, true);
    return () => {
      cancel();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key, true);
    };
  }, [scrollRef]);

  return {
    draggedId, destination, saving,
    suppressClick: () => Date.now() < suppressUntil.current,
    start: (event: ReactPointerEvent<HTMLElement>, hostId: string) => {
      if (event.button !== 0 || !event.isPrimary || pending.current) return;
      drag.current = { hostId, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
        startX: event.clientX, startY: event.clientY, active: false, element: event.currentTarget };
    }
  };
}
