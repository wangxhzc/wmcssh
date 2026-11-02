import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { readText, writeText, readPrimarySelection, writePrimarySelection } from "../../../services/tauri/clipboardApi";
import { terminalClipboardShortcut } from "../clipboardShortcuts";
import { installSelectionMouseGuard } from "../selectionMouseGuard";
import { installMouseWheelNormalizer } from "../mouseWheelNormalizer";
import { useSettingsStore } from "../../../stores/settingsStore";
import { loadTerminalFonts } from "../terminalFonts";
import { terminalRegistry } from "../terminalRegistry";
import { queueTerminalInput } from "../actions";
import { useAnchoredMenuPosition } from "../../../app/useAnchoredMenuPosition";
import { PastePreviewDialog } from "./PastePreviewDialog";
import { createPasteRequest } from "../pasteRequest";

export type TerminalViewProps = {
  tabId: string;
  sessionId?: string;
  active: boolean;
};

export function TerminalView(props: TerminalViewProps) {
  const settings = useSettingsStore((state) => state.terminalSettings);
  const [fontsReady, setFontsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadTerminalFonts(settings).then(() => {
      if (!cancelled) setFontsReady(true);
    });
    return () => { cancelled = true; };
  }, [settings]);

  // SSH bytes may already be arriving; the registry keeps parsing them while
  // the view waits. No terminal buffer or connection is recreated here.
  return fontsReady ? <TerminalSurface {...props} /> : <div className="terminal-font-loading" role="status">正在加载终端字体…</div>;
}

function TerminalSurface({ tabId, sessionId, active }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const scrollbarTrackRef = useRef<HTMLDivElement | null>(null);
  const scrollbarThumbRef = useRef<HTMLDivElement | null>(null);
  const middlePasteLockRef = useRef<number>(0);
  const activeRef = useRef(active);
  activeRef.current = active;
  const pastePendingRef = useRef(false);
  const [pastePreview, setPastePreview] = useState<{ text: string; send: () => void } | null>(null);
  const terminalSettings = useSettingsStore((state) => state.terminalSettings);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const contextMenuPosition = useAnchoredMenuPosition(contextMenu, menuRef);

  const closeContextMenu = () => setContextMenu(null);

  const requestPaste = (text: string, runtime: NonNullable<ReturnType<typeof terminalRegistry.get>>) => {
    if (!text || !activeRef.current || pastePendingRef.current || terminalRegistry.get(tabId) !== runtime) return;
    const request = createPasteRequest(text, runtime, () => terminalRegistry.get(tabId) === runtime);
    if (request.needsPreview) {
      pastePendingRef.current = true;
      setPastePreview(request);
    } else request.send();
  };

  const closePastePreview = () => {
    pastePendingRef.current = false;
    setPastePreview(null);
  };

  useEffect(() => { closePastePreview(); }, [active, sessionId]);

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
    runtime.disposables.push(installSelectionMouseGuard(element, runtime.terminal));
    runtime.disposables.push(installMouseWheelNormalizer(element, runtime.terminal));
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

    const handleMiddleMouseDown = (event: MouseEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      middlePasteLockRef.current = Date.now();
      runtime.terminal.focus();
      closeContextMenu();
      void (isLinux ? readPrimarySelection() : readText()).then((text) => {
        if (text) requestPaste(text, runtime);
      }).catch((error) => console.error("[wmcssh][terminal] middle paste failed", error));
    };
    const handleMiddleAuxClick = (event: MouseEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      middlePasteLockRef.current = Date.now();
    };
    element.addEventListener("mousedown", handleMiddleMouseDown, true);
    element.addEventListener("auxclick", handleMiddleAuxClick, true);
    runtime.disposables.push({ dispose: () => {
      element.removeEventListener("mousedown", handleMiddleMouseDown, true);
      element.removeEventListener("auxclick", handleMiddleAuxClick, true);
    } });

    const handleClipboardShortcut = (event: KeyboardEvent) => {
      const action = terminalClipboardShortcut(event, isLinux);
      if (!action) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      const selection = runtime.terminal.getSelection();
      const operation = action === "copy"
        ? (selection ? writeText(selection) : Promise.resolve())
        : (action === "pastePrimary" ? readPrimarySelection() : readText()).then((text) => {
            if (text) requestPaste(text, runtime);
          });
      void operation.catch((error) => console.error("[wmcssh][terminal] clipboard operation failed", error));
    };
    // Block WebView's native middle-button paste when we own that gesture.
    const handleMiddleMouseUp = (event: MouseEvent) => {
      if (event.button !== 1) return;
      middlePasteLockRef.current = Date.now();
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const handleNativeMiddlePaste = (event: ClipboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (Date.now() - middlePasteLockRef.current < 250) return;
      const text = event.clipboardData?.getData("text/plain");
      if (text) requestPaste(text, runtime);
    };
    element.addEventListener("keydown", handleClipboardShortcut, true);
    element.addEventListener("mouseup", handleMiddleMouseUp, true);
    element.addEventListener("paste", handleNativeMiddlePaste, true);
    runtime.disposables.push({ dispose: () => {
      element.removeEventListener("keydown", handleClipboardShortcut, true);
      element.removeEventListener("mouseup", handleMiddleMouseUp, true);
      element.removeEventListener("paste", handleNativeMiddlePaste, true);
    } });

    const inputDisposable = runtime.terminal.onData((data) => {
      queueTerminalInput(tabId, data);
    });
    let selectionCopyTimer: number | undefined;
    const selectionDisposable = runtime.terminal.onSelectionChange(() => {
      // Selection change events fire continuously while dragging. Delay reading
      // the selected text so a large selection is not repeatedly materialized
      // and sent across the clipboard IPC boundary on every pointer movement.
      window.clearTimeout(selectionCopyTimer);
      selectionCopyTimer = window.setTimeout(() => {
        const selection = runtime.terminal.getSelection();
        if (!selection) return;

        void (isLinux ? writePrimarySelection(selection) : writeText(selection)).catch((error) => {
          console.error("[wmcssh][terminal] failed to copy selection", error);
        });
      }, 150);
    });

    runtime.disposables.push(inputDisposable);
    runtime.disposables.push(selectionDisposable);
    runtime.disposables.push({
      dispose: () => window.clearTimeout(selectionCopyTimer)
    });

    requestAnimationFrame(() => terminalRegistry.fit(tabId));
  }, [tabId, terminalSettings]);

  useEffect(() => {
    if (sessionId) {
      terminalRegistry.bindSession(tabId, sessionId);
    }
  }, [tabId, sessionId]);

  useEffect(() => {
    const runtime = terminalRegistry.get(tabId);
    const track = scrollbarTrackRef.current;
    const thumb = scrollbarThumbRef.current;
    if (!runtime || !track || !thumb) return;

    let updateFrame = 0;
    const updateScrollbar = () => {
      const buffer = runtime.terminal.buffer.active;
      const trackHeight = track.clientHeight;
      const totalLines = Math.max(runtime.terminal.rows, buffer.baseY + runtime.terminal.rows);
      const thumbHeight = Math.max(28, Math.round(trackHeight * runtime.terminal.rows / totalLines));
      const availableTravel = Math.max(0, trackHeight - thumbHeight);
      const thumbTop = buffer.baseY > 0
        ? Math.round(availableTravel * buffer.viewportY / buffer.baseY)
        : 0;

      thumb.style.height = `${Math.min(trackHeight, thumbHeight)}px`;
      thumb.style.transform = `translateY(${thumbTop}px)`;
    };
    const scheduleScrollbarUpdate = () => {
      window.cancelAnimationFrame(updateFrame);
      updateFrame = window.requestAnimationFrame(updateScrollbar);
    };

    let dragOffset = 0;
    const scrollFromPointer = (clientY: number) => {
      const bounds = track.getBoundingClientRect();
      const thumbHeight = thumb.offsetHeight;
      const availableTravel = Math.max(0, bounds.height - thumbHeight);
      const top = Math.min(availableTravel, Math.max(0, clientY - bounds.top - dragOffset));
      const maxScroll = runtime.terminal.buffer.active.baseY;
      runtime.terminal.scrollToLine(availableTravel > 0 ? Math.round(maxScroll * top / availableTravel) : 0);
    };
    const handlePointerDown = (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const thumbBounds = thumb.getBoundingClientRect();
      dragOffset = event.target === thumb
        ? event.clientY - thumbBounds.top
        : thumbBounds.height / 2;
      track.setPointerCapture(event.pointerId);
      scrollFromPointer(event.clientY);
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (!track.hasPointerCapture(event.pointerId)) return;
      event.preventDefault();
      scrollFromPointer(event.clientY);
    };

    const viewport = containerRef.current?.querySelector<HTMLElement>(".xterm-viewport");
    const scrollDisposable = runtime.terminal.onScroll(scheduleScrollbarUpdate);
    const writeDisposable = runtime.terminal.onWriteParsed(scheduleScrollbarUpdate);
    const resizeDisposable = runtime.terminal.onResize(scheduleScrollbarUpdate);
    viewport?.addEventListener("scroll", scheduleScrollbarUpdate, { passive: true });
    containerRef.current?.addEventListener("wheel", scheduleScrollbarUpdate, { passive: true });
    track.addEventListener("pointerdown", handlePointerDown);
    track.addEventListener("pointermove", handlePointerMove);
    requestAnimationFrame(updateScrollbar);

    return () => {
      window.cancelAnimationFrame(updateFrame);
      scrollDisposable.dispose();
      writeDisposable.dispose();
      resizeDisposable.dispose();
      viewport?.removeEventListener("scroll", scheduleScrollbarUpdate);
      containerRef.current?.removeEventListener("wheel", scheduleScrollbarUpdate);
      track.removeEventListener("pointerdown", handlePointerDown);
      track.removeEventListener("pointermove", handlePointerMove);
    };
  }, [tabId]);

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
        terminalRegistry.fitAndResize(tabId);
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
        style={{
          height: "100%",
          width: "calc(100% - var(--scrollbar-size) - var(--terminal-scrollbar-gap))"
        }}
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
      <div ref={scrollbarTrackRef} className="terminal-scrollbar" aria-hidden="true">
        <div ref={scrollbarThumbRef} className="terminal-scrollbar-thumb" />
      </div>
      {active && pastePreview ? <PastePreviewDialog text={pastePreview.text}
        onClose={closePastePreview} onConfirm={() => {
          if (!pastePendingRef.current) return;
          closePastePreview();
          pastePreview.send();
        }} /> : null}
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
                  const current = terminalRegistry.get(tabId);
                  if (current) requestPaste(text, current);
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
