import { useLayoutEffect, useRef, useState } from "react";

export function TerminalTabTitle({ title, active }: { title: string; active: boolean }) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;
    let disposed = false;
    // Compare against the whole title slot, not the space remaining beside
    // the dots, so showing the suffix cannot keep itself enabled.
    const update = () => {
      if (!disposed) setOverflow(text.scrollWidth > container.clientWidth);
    };
    const observer = new ResizeObserver(update);
    observer.observe(container);
    observer.observe(text);
    update();
    void document.fonts.ready.then(update);
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [title, active]);

  return (
    <span ref={containerRef} className="terminal-tab-title" aria-label={title}>
      <span ref={textRef} className="terminal-tab-title-text" aria-hidden="true">{title}</span>
      {overflow ? <span className="terminal-tab-title-dots" aria-hidden="true">...</span> : null}
    </span>
  );
}
