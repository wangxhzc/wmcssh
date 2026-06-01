import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";

type Point = {
  x: number;
  y: number;
};

export function useAnchoredMenuPosition(
  anchor: Point | null,
  menuRef: RefObject<HTMLElement | null>,
  margin = 8
) {
  const [position, setPosition] = useState<Point | null>(anchor);

  useLayoutEffect(() => {
    setPosition(anchor);
  }, [anchor]);

  useLayoutEffect(() => {
    if (!anchor || !menuRef.current) return;

    const rect = menuRef.current.getBoundingClientRect();
    const maxX = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxY = Math.max(margin, window.innerHeight - rect.height - margin);
    const x = Math.min(Math.max(anchor.x, margin), maxX);
    const y = Math.min(Math.max(anchor.y, margin), maxY);

    setPosition((prev) => {
      if (prev && prev.x === x && prev.y === y) {
        return prev;
      }
      return { x, y };
    });
  }, [anchor, margin, menuRef]);

  return position;
}
