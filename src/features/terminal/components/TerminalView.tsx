import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { sshResize } from "../../../services/tauri/sshApi";
import { useSettingsStore } from "../../../stores/settingsStore";
import { terminalRegistry } from "../terminalRegistry";
import { queueTerminalInput } from "../actions";
import { useAnchoredMenuPosition } from "../../../app/useAnchoredMenuPosition";

export type TerminalViewProps = {
  tabId: string;
  sessionId?: string;
  active: boolean;
};

export function TerminalView({ tabId, sessionId, active }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const terminalSettings = useSettingsStore((state) => state.terminalSettings);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const contextMenuPosition = useAnchoredMenuPosition(contextMenu, menuRef);

  const closeContextMenu = () => setContextMenu(null);

  useLayoutEffect(() => {
    let runtime = terminalRegistry.get(tabId);

    if (!runtime) {
      runtime = terminalRegistry.create(tabId, terminalSettings);
    }

    if (!containerRef.current || runtime.mounted) {
      return;
    }

    runtime.terminal.open(containerRef.current);
    runtime.terminal.focus();
    runtime.mounted = true;
    terminalRegistry.flush(tabId);
    console.debug("[wmcssh][terminal] mounted", { tabId });

    const inputDisposable = runtime.terminal.onData((data) => {
      queueTerminalInput(tabId, data);
    });

    runtime.disposables.push(inputDisposable);

    requestAnimationFrame(() => terminalRegistry.fit(tabId));
  }, [tabId, terminalSettings]);

  useEffect(() => {
    if (sessionId) {
      terminalRegistry.bindSession(tabId, sessionId);
    }
  }, [tabId, sessionId]);

  useEffect(() => {
    if (active) {
      const runtime = terminalRegistry.get(tabId);
      runtime?.terminal.focus();
      console.debug("[wmcssh][terminal] focus", { tabId });
    }
  }, [active, tabId]);

  useEffect(() => {
    if (!active || !sessionId) return;

    requestAnimationFrame(() => terminalRegistry.fitAndResize(tabId));
  }, [active, sessionId, tabId]);

  useEffect(() => {
    if (!active) return;

    const element = containerRef.current;
    if (!element) return;

    let timeout: number | undefined;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => {
        const runtime = terminalRegistry.get(tabId);
        if (!runtime?.sessionId) return;

        runtime.fitAddon.fit();
        void sshResize({
          sessionId: runtime.sessionId,
          cols: runtime.terminal.cols,
          rows: runtime.terminal.rows
        });
      }, 80);
    });

    observer.observe(element);
    requestAnimationFrame(() => terminalRegistry.fitAndResize(tabId));

    return () => {
      window.clearTimeout(timeout);
      observer.disconnect();
    };
  }, [active, tabId]);

  useEffect(() => {
    const runtime = terminalRegistry.get(tabId);
    if (!runtime) return;

    const fontSet = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!fontSet?.ready) return;

    void fontSet.ready.then(() => {
      const current = terminalRegistry.get(tabId);
      if (!current?.mounted) return;
      current.terminal.clearTextureAtlas();
      current.terminal.refresh(0, Math.max(0, current.terminal.rows - 1));
      terminalRegistry.fitAndResize(tabId);
    });
  }, [tabId]);

  useEffect(() => {
    if (!contextMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current?.contains(target)) return;
      closeContextMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  const runtime = terminalRegistry.get(tabId);

  return (
    <>
      <div
        ref={containerRef}
        className="terminal-root"
        style={{ height: "100%", width: "100%" }}
        data-tab-id={tabId}
        tabIndex={0}
        onMouseDown={() => {
          terminalRegistry.get(tabId)?.terminal.focus();
          terminalRegistry.fitAndResize(tabId);
          closeContextMenu();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          terminalRegistry.get(tabId)?.terminal.focus();
          setContextMenu({
            x: event.clientX,
            y: event.clientY
          });
        }}
      />
      {contextMenu ? (
        <div
          ref={menuRef}
          className="app-context-menu terminal-context-menu"
          style={{ left: contextMenuPosition?.x ?? contextMenu.x, top: contextMenuPosition?.y ?? contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <button
            type="button"
            onClick={async () => {
              closeContextMenu();
              const selection = runtime?.terminal.getSelection();
              if (!selection) return;
              await writeText(selection);
            }}
          >
            复制
          </button>
          <button
            type="button"
            onClick={async () => {
              closeContextMenu();
              const text = await readText();
              if (!text) return;
              queueTerminalInput(tabId, text);
            }}
          >
            粘贴
          </button>
          <button
            type="button"
            onClick={() => {
              closeContextMenu();
              runtime?.terminal.selectAll();
            }}
          >
            全选
          </button>
          <button
            type="button"
            onClick={() => {
              closeContextMenu();
              runtime?.terminal.clear();
            }}
          >
            清屏
          </button>
        </div>
      ) : null}
    </>
  );
}
