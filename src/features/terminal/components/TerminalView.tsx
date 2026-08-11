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
  const middlePasteLockRef = useRef<number>(0);
  const terminalSettings = useSettingsStore((state) => state.terminalSettings);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const contextMenuPosition = useAnchoredMenuPosition(contextMenu, menuRef);

  const closeContextMenu = () => setContextMenu(null);

  const focusTerminal = () => {
    requestAnimationFrame(() => {
      terminalRegistry.get(tabId)?.terminal.focus();
    });
  };

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

    const element = containerRef.current;
    const isLinux = /linux/i.test(navigator.platform) || /linux/i.test(navigator.userAgent);

    // WebKitGTK may dispatch `insertText` events for every IME pre-edit update.
    // Besides sending those updates, xterm's CompositionHelper can retain them
    // in its hidden textarea and resend the stale value with the next Chinese
    // input. Own the complete composition lifecycle here: send only the value
    // confirmed by compositionend, then clear the hidden textarea.
    let isComposing = false;
    let compositionEndTimer: number | undefined;
    let suppressTrailingInput = false;
    const handleCompositionStart = (event: Event) => {
      window.clearTimeout(compositionEndTimer);
      isComposing = true;
      suppressTrailingInput = false;
      event.stopImmediatePropagation();
    };
    const handleCompositionUpdate = (event: Event) => {
      event.stopImmediatePropagation();
    };
    const handleCompositionEnd = (event: Event) => {
      const compositionEvent = event as CompositionEvent;
      event.stopImmediatePropagation();
      isComposing = false;
      suppressTrailingInput = true;

      if (compositionEvent.data) {
        queueTerminalInput(tabId, compositionEvent.data);
      }
      if (runtime.terminal.textarea) {
        runtime.terminal.textarea.value = "";
      }

      window.clearTimeout(compositionEndTimer);
      compositionEndTimer = window.setTimeout(() => {
        suppressTrailingInput = false;
        if (runtime.terminal.textarea) {
          runtime.terminal.textarea.value = "";
        }
      }, 0);
    };
    const handleComposingInput = (event: Event) => {
      const inputEvent = event as InputEvent;
      if (!isComposing && !suppressTrailingInput && !inputEvent.isComposing) return;

      event.stopImmediatePropagation();
    };
    const handleComposingKeyDown = (event: Event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (!isComposing && !keyboardEvent.isComposing && keyboardEvent.keyCode !== 229) return;

      event.stopImmediatePropagation();
    };

    element.addEventListener("compositionstart", handleCompositionStart, true);
    element.addEventListener("compositionupdate", handleCompositionUpdate, true);
    element.addEventListener("compositionend", handleCompositionEnd, true);
    element.addEventListener("input", handleComposingInput, true);
    element.addEventListener("keydown", handleComposingKeyDown, true);
    runtime.disposables.push({
      dispose: () => {
        window.clearTimeout(compositionEndTimer);
        element.removeEventListener("compositionstart", handleCompositionStart, true);
        element.removeEventListener("compositionupdate", handleCompositionUpdate, true);
        element.removeEventListener("compositionend", handleCompositionEnd, true);
        element.removeEventListener("input", handleComposingInput, true);
        element.removeEventListener("keydown", handleComposingKeyDown, true);
      }
    });

    if (element && !isLinux) {
      const pasteMiddleClick = () => {
        terminalRegistry.get(tabId)?.terminal.focus();
        closeContextMenu();
        void readText()
          .then((text) => {
            if (!text) return;
            queueTerminalInput(tabId, text);
          })
          .catch((error) => {
            console.error("[wmcssh][terminal] failed to paste from middle click", error);
          });
      };

      const handleMiddleMouseDown: EventListener = (event) => {
        const mouseEvent = event as MouseEvent;
        if (mouseEvent.button !== 1) return;

        const now = Date.now();
        if (now - middlePasteLockRef.current < 250) {
          mouseEvent.preventDefault();
          mouseEvent.stopPropagation();
          mouseEvent.stopImmediatePropagation();
          return;
        }

        middlePasteLockRef.current = now;
        mouseEvent.preventDefault();
        mouseEvent.stopPropagation();
        mouseEvent.stopImmediatePropagation();
        pasteMiddleClick();
        window.setTimeout(() => {
          if (Date.now() - middlePasteLockRef.current >= 250) {
            middlePasteLockRef.current = 0;
          }
        }, 250);
      };

      const handleMiddleAuxClick: EventListener = (event) => {
        const mouseEvent = event as MouseEvent;
        if (mouseEvent.button !== 1) return;

        mouseEvent.preventDefault();
        mouseEvent.stopPropagation();
        mouseEvent.stopImmediatePropagation();
        if (Date.now() - middlePasteLockRef.current < 250) {
          return;
        }

        middlePasteLockRef.current = Date.now();
        pasteMiddleClick();
        window.setTimeout(() => {
          if (Date.now() - middlePasteLockRef.current >= 250) {
            middlePasteLockRef.current = 0;
          }
        }, 250);
      };

      element.addEventListener("mousedown", handleMiddleMouseDown, true);
      element.addEventListener("auxclick", handleMiddleAuxClick, true);

      runtime.disposables.push({
        dispose: () => {
          element.removeEventListener("mousedown", handleMiddleMouseDown, true);
          element.removeEventListener("auxclick", handleMiddleAuxClick, true);
        }
      });
    }

    const inputDisposable = runtime.terminal.onData((data) => {
      queueTerminalInput(tabId, data);
    });
    const selectionDisposable = runtime.terminal.onSelectionChange(() => {
      const selection = runtime?.terminal.getSelection();
      if (!selection) return;

      void writeText(selection).catch((error) => {
        console.error("[wmcssh][terminal] failed to copy selection", error);
      });
    });

    runtime.disposables.push(inputDisposable);
    runtime.disposables.push(selectionDisposable);

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
        onMouseDown={(event) => {
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
          onMouseDown={(event) => {
            // Keep xterm's hidden textarea focused while using the menu. When a
            // menu button receives focus and is then unmounted, WebKitGTK moves
            // focus to the document body and keyboard input stops reaching xterm.
            event.preventDefault();
          }}
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
              try {
                const text = await readText();
                if (text) {
                  queueTerminalInput(tabId, text);
                }
              } finally {
                focusTerminal();
              }
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
