import { useLayoutEffect, useRef } from "react";

const dialogs: HTMLElement[] = [];

/** Shared modal keyboard handling, including nested dialogs and focus return. */
export function useDialogFocus<T extends HTMLElement = HTMLDivElement>(open: boolean, onClose?: () => void, busy = false) {
  const ref = useRef<T>(null);
  const options = useRef({ onClose, busy });
  options.current = { onClose, busy };
  useLayoutEffect(() => {
    const element = ref.current;
    if (!open || !element) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogs.push(element);
    const top = () => dialogs[dialogs.length - 1] === element;
    const controls = () => Array.from(element.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])"
    )).filter((item) => item.getClientRects().length > 0);
    const focus = () => (controls().find((item) => item.matches("input, select, textarea")) ?? controls()[0] ?? element).focus();
    element.tabIndex = -1;
    if (!element.contains(document.activeElement)) focus();
    const keydown = (event: KeyboardEvent) => {
      if (!top()) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!options.current.busy) options.current.onClose?.();
      }
      if (event.key === "Tab") {
        const items = controls();
        const index = items.indexOf(document.activeElement as HTMLElement);
        if (!items.length || index < 0 || (event.shiftKey ? index === 0 : index === items.length - 1)) {
          event.preventDefault();
          (event.shiftKey ? items[items.length - 1] : items[0])?.focus();
        }
      }
    };
    const focusin = () => { if (top() && !element.contains(document.activeElement)) focus(); };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("focusin", focusin);
    return () => {
      dialogs.splice(dialogs.indexOf(element), 1);
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("focusin", focusin);
      queueMicrotask(() => {
        const currentDialog = dialogs[dialogs.length - 1];
        if (previous?.isConnected && previous.getClientRects().length > 0 &&
          (!currentDialog || currentDialog.contains(previous))) previous.focus();
      });
    };
  }, [open]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (open && element && dialogs[dialogs.length - 1] === element && !element.contains(document.activeElement)) {
      (element.querySelector<HTMLElement>("input:not(:disabled), button:not(:disabled)") ?? element).focus();
    }
  });
  return ref;
}
