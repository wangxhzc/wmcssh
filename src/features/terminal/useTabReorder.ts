import { type PointerEvent as ReactPointerEvent, type RefObject, useEffect, useRef, useState } from "react";

type Destination = { targetTabId: string; after: boolean };
type Drag = {
  tabId: string;
  pointerId: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  active: boolean;
  element: HTMLElement;
};

export function useTabReorder(
  scrollRef: RefObject<HTMLElement | null>,
  onMove: (tabId: string, targetTabId: string, after: boolean) => void
) {
  const callback = useRef(onMove);
  callback.current = onMove;
  const drag = useRef<Drag | null>(null);
  const drop = useRef<Destination | null>(null);
  const suppressUntil = useRef(0);
  const [draggedId, setDraggedId] = useState<string>();
  const [destination, setDestination] = useState<Destination | null>(null);

  useEffect(() => {
    let frame = 0;
    let previousTime = 0;
    const setDrop = (value: Destination | null) => {
      if (drop.current?.targetTabId === value?.targetTabId && drop.current?.after === value?.after) return;
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
      const tab = document.elementFromPoint(current.x, current.y)?.closest<HTMLElement>("[data-tab-id]");
      if (!tab || !scroller.contains(tab) || tab.dataset.tabId === current.tabId) {
        setDrop(null);
        return;
      }
      const rect = tab.getBoundingClientRect();
      setDrop({ targetTabId: tab.dataset.tabId!, after: current.x > rect.left + rect.width / 2 });
    };
    const tick = (time: number) => {
      const current = drag.current;
      const scroller = scrollRef.current;
      if (!current?.active || !scroller) return;
      const bounds = scroller.getBoundingClientRect();
      const elapsed = previousTime ? Math.min(32, time - previousTime) : 16;
      previousTime = time;
      if (current.y >= bounds.top && current.y <= bounds.bottom && current.x >= bounds.left && current.x <= bounds.right) {
        const edge = Math.min(36, (bounds.right - bounds.left) / 2);
        const speed = edge <= 0 ? 0 : current.x < bounds.left + edge ? -(bounds.left + edge - current.x) / edge
          : current.x > bounds.right - edge ? (current.x - bounds.right + edge) / edge : 0;
        scroller.scrollLeft += speed * elapsed * 0.6;
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
      if (commit && current.active && target) callback.current(current.tabId, target.targetTabId, target.after);
    };
    const move = (event: PointerEvent) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      current.x = event.clientX;
      current.y = event.clientY;
      if (!current.active && Math.hypot(current.x - current.startX, current.y - current.startY) >= 6) {
        current.active = true;
        current.element.setPointerCapture(current.pointerId);
        setDraggedId(current.tabId);
        frame = requestAnimationFrame(tick);
      }
      if (current.active) { event.preventDefault(); locate(); }
    };
    const up = (event: PointerEvent) => {
      if (drag.current?.pointerId !== event.pointerId) return;
      if (drag.current.active) {
        drag.current.x = event.clientX;
        drag.current.y = event.clientY;
        locate();
      }
      finish(true);
    };
    const cancel = () => finish(false);
    const lostCapture = (event: PointerEvent) => {
      if (drag.current?.pointerId === event.pointerId) cancel();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && drag.current) { event.preventDefault(); cancel(); }
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("lostpointercapture", lostCapture);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key, true);
    return () => {
      cancel();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("lostpointercapture", lostCapture);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key, true);
    };
  }, [scrollRef]);

  return {
    draggedId,
    destination,
    suppressClick: () => Date.now() < suppressUntil.current,
    start: (event: ReactPointerEvent<HTMLElement>, tabId: string) => {
      if (event.button !== 0 || !event.isPrimary || drag.current) return;
      if ((event.target as Element).closest(".tab-close")) return;
      drag.current = {
        tabId, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
        startX: event.clientX, startY: event.clientY, active: false, element: event.currentTarget
      };
    }
  };
}
