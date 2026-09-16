import { useEffect, useMemo, useRef, useState } from "react";
import { readText, writeText } from "../services/tauri/clipboardApi";
import { useAnchoredMenuPosition } from "./useAnchoredMenuPosition";

type Field = HTMLInputElement | HTMLTextAreaElement;
type Action = "undo" | "redo" | "cut" | "copy" | "paste" | "delete" | "selectAll";
type Menu = { x: number; y: number; field: Field; value: string; start: number; end: number };
const labels: Record<Action, string> = {
  undo: "撤销", redo: "重做", cut: "剪切", copy: "复制", paste: "粘贴", delete: "删除", selectAll: "全选"
};

export function EditingContextMenu() {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [active, setActive] = useState<Action | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = useRef(menu);
  current.current = menu;
  const anchor = useMemo(() => menu ? { x: menu.x, y: menu.y } : null, [menu, error]);
  const position = useAnchoredMenuPosition(anchor, menuRef);
  const selected = !!menu && menu.end > menu.start;
  const editable = !!menu && !menu.field.readOnly && !menu.field.disabled;
  const secret = menu?.field.type === "password";
  const enabled: Record<Action, boolean> = {
    undo: editable && document.queryCommandEnabled("undo"),
    redo: editable && document.queryCommandEnabled("redo"),
    cut: editable && selected && !secret,
    copy: selected && !secret,
    paste: editable,
    delete: editable && selected,
    selectAll: !!menu?.value
  };

  useEffect(() => {
    const contextmenu = (event: MouseEvent) => {
      event.preventDefault();
      setMenu(null);
      const field = event.target;
      if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)
        || field.closest(".xterm") || field.disabled
        || (field instanceof HTMLInputElement && !["text", "search", "url", "tel", "email", "password", "number"].includes(field.type))) return;
      field.focus();
      const rect = field.getBoundingClientRect();
      setMenu({
        field, value: field.value,
        start: field.selectionStart ?? 0, end: field.selectionEnd ?? field.value.length,
        x: event.clientX || rect.left, y: event.clientY || rect.bottom
      });
      setActive(null);
      setError("");
      setBusy(false);
    };
    const dismiss = () => setMenu(null);
    const pointerdown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) dismiss();
    };
    const focusin = (event: FocusEvent) => {
      if (current.current && event.target !== current.current.field) dismiss();
    };
    const scroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) dismiss();
    };
    document.addEventListener("contextmenu", contextmenu, true);
    document.addEventListener("pointerdown", pointerdown, true);
    document.addEventListener("focusin", focusin);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("blur", dismiss);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("contextmenu", contextmenu, true);
      document.removeEventListener("pointerdown", pointerdown, true);
      document.removeEventListener("focusin", focusin);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("resize", dismiss);
    };
  }, []);

  async function run(action: Action) {
    if (!menu || busy || !enabled[action]) return;
    const { field, value, start, end } = menu;
    const valid = () => current.current === menu && field.isConnected && field.value === value
      && document.activeElement === field && !field.disabled;
    if (!valid()) { setMenu(null); return; }
    setBusy(true);
    try {
      let replacement = "";
      if (action === "copy" || action === "cut") await writeText(value.slice(start, end));
      if (action === "paste") replacement = await readText() ?? "";
      if (!valid()) return;
      if (action === "selectAll") field.select();
      else if (action === "undo" || action === "redo") document.execCommand(action);
      else if (action !== "copy" && !field.readOnly) {
        if (action === "paste" && !replacement) { setMenu(null); return; }
        if (field.type === "number" && replacement) {
          const probe = document.createElement("input");
          probe.type = "number";
          probe.value = replacement;
          if (!probe.value) { setError("剪贴板内容不是有效数字"); return; }
        }
        const supportsSelection = field.selectionStart !== null;
        if (supportsSelection) field.setSelectionRange(start, end);
        // Native editing preserves the browser undo stack and emits React's input event.
        const changed = supportsSelection && document.execCommand(replacement ? "insertText" : "delete", false, replacement);
        if (!changed) {
          const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, value.slice(0, start) + replacement + value.slice(end));
          field.dispatchEvent(new Event("input", { bubbles: true }));
          if (supportsSelection) field.setSelectionRange(start + replacement.length, start + replacement.length);
        }
      }
      setMenu(null);
    } catch {
      if (current.current === menu) setError("剪贴板操作失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!menu) return;
    const keydown = (event: KeyboardEvent) => {
      if (["Escape", "ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === "Escape") { setMenu(null); return; }
        if (busy) return;
        const actions = (Object.keys(labels) as Action[]).filter((action) => enabled[action]);
        if (event.key === "Enter" || event.key === " ") { if (active) void run(active); return; }
        const index = active ? actions.indexOf(active) : -1;
        const next = event.key === "Home" ? 0 : event.key === "End" ? actions.length - 1
          : event.key === "ArrowDown" ? (index + 1) % actions.length : (index < 0 ? actions.length - 1 : (index - 1 + actions.length) % actions.length);
        setActive(actions[next] ?? null);
      } else setMenu(null);
    };
    // Run before modal Escape handling while leaving focus on the edited field.
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  });

  if (!menu) return null;
  return (
    <div ref={menuRef} className="app-context-menu editing-context-menu" role="menu" aria-label="编辑"
      aria-activedescendant={active ? `edit-menu-${active}` : undefined}
      style={{ left: position?.x ?? menu.x, top: position?.y ?? menu.y }}
      onMouseDown={(event) => event.preventDefault()}>
      {(Object.keys(labels) as Action[]).map((action) => (
        <button key={action} id={`edit-menu-${action}`} type="button" role="menuitem" tabIndex={-1}
          className={active === action ? "active" : undefined} disabled={busy || !enabled[action]}
          onMouseEnter={() => setActive(action)} onClick={() => void run(action)}>{labels[action]}</button>
      ))}
      {error ? <div className="editing-context-menu-error" role="alert">{error}</div> : null}
    </div>
  );
}
