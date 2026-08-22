import { type RefObject, useEffect, useRef } from "react";

type CustomScrollbarProps = {
  scrollRef: RefObject<HTMLElement | null>;
};

export function CustomScrollbar({ scrollRef }: CustomScrollbarProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const scroller = scrollRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!scroller || !track || !thumb) return;

    const update = () => {
      const trackHeight = track.clientHeight;
      const scrollRange = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const thumbHeight = scrollRange > 0
        ? Math.max(28, Math.round(trackHeight * scroller.clientHeight / scroller.scrollHeight))
        : trackHeight;
      const travel = Math.max(0, trackHeight - thumbHeight);
      const top = scrollRange > 0 ? Math.round(travel * scroller.scrollTop / scrollRange) : 0;

      track.classList.toggle("inactive", scrollRange === 0);
      thumb.style.height = `${Math.min(trackHeight, thumbHeight)}px`;
      thumb.style.transform = `translateY(${top}px)`;
    };

    let dragOffset = 0;
    const scrollFromPointer = (clientY: number) => {
      const bounds = track.getBoundingClientRect();
      const thumbHeight = thumb.offsetHeight;
      const travel = Math.max(0, bounds.height - thumbHeight);
      const top = Math.min(travel, Math.max(0, clientY - bounds.top - dragOffset));
      const scrollRange = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      scroller.scrollTop = travel > 0 ? scrollRange * top / travel : 0;
    };
    const handlePointerDown = (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const bounds = thumb.getBoundingClientRect();
      dragOffset = event.target === thumb ? event.clientY - bounds.top : bounds.height / 2;
      track.setPointerCapture(event.pointerId);
      scrollFromPointer(event.clientY);
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (!track.hasPointerCapture(event.pointerId)) return;
      event.preventDefault();
      scrollFromPointer(event.clientY);
    };

    const resizeObserver = new ResizeObserver(update);
    const mutationObserver = new MutationObserver(update);
    resizeObserver.observe(scroller);
    mutationObserver.observe(scroller, { childList: true, subtree: true });
    scroller.addEventListener("scroll", update, { passive: true });
    track.addEventListener("pointerdown", handlePointerDown);
    track.addEventListener("pointermove", handlePointerMove);
    requestAnimationFrame(update);

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      scroller.removeEventListener("scroll", update);
      track.removeEventListener("pointerdown", handlePointerDown);
      track.removeEventListener("pointermove", handlePointerMove);
    };
  }, [scrollRef]);

  return (
    <div ref={trackRef} className="custom-scrollbar" aria-hidden="true">
      <div ref={thumbRef} className="custom-scrollbar-thumb" />
    </div>
  );
}
