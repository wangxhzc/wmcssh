import { useEffect, useRef, useState, type RefObject } from "react";
import { listenFileDrop } from "../../services/tauri/fileTransferApi";
import { dropPositionInside } from "./dropTarget";

export function useFileDrop(
  target: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  onDrop: (paths: string[]) => Promise<void>,
  onError: (error: unknown) => void
) {
  const latest = useRef({ enabled, onDrop, onError });
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    latest.current = { enabled, onDrop, onError };
    if (!enabled) setHovered(false);
  }, [enabled, onDrop, onError]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenFileDrop((event) => {
      if (disposed) return;
      const element = target.current;
      if (event.type === "leave" || !latest.current.enabled || !element
        || document.querySelector('[aria-modal="true"]')) {
        setHovered(false);
        return;
      }
      const inside = dropPositionInside(event.position, element.getBoundingClientRect(), window.devicePixelRatio);
      setHovered(event.type !== "drop" && inside);
      if (event.type === "drop" && inside) {
        void latest.current.onDrop(event.paths).catch((error) => latest.current.onError(error));
      }
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch((error) => {
      if (!disposed) latest.current.onError(error);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [target]);

  return hovered;
}
