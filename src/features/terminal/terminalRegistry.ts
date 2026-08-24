import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { Channel } from "@tauri-apps/api/core";
import type { TerminalSettingsDto } from "../../types/settings";
import type { SshDataEvent } from "../../types/ssh";
import { defaultTerminalSettings } from "../../types/settings";
import { sshResize } from "../../services/tauri/sshApi";

const DEFAULT_TERMINAL_THEME = {
  background: "#1C1C1C",
  foreground: "#E4E4E4",
  cursor: "#7AA2D6",
  cursorAccent: "#1C1C1C",
  selectionBackground: "#7AA2D6",
  selectionForeground: "#181818",
  selectionInactiveBackground: "#425F7F",
  black: "#181818",
  red: "#C97B7B",
  green: "#81B29A",
  yellow: "#D0AD78",
  blue: "#7AA2D6",
  magenta: "#A0A0A0",
  cyan: "#81B29A",
  white: "#E4E4E4",
  brightBlack: "#6F6F6F",
  brightRed: "#C97B7B",
  brightGreen: "#81B29A",
  brightYellow: "#D0AD78",
  brightBlue: "#7AA2D6",
  brightMagenta: "#A0A0A0",
  brightCyan: "#81B29A",
  brightWhite: "#E4E4E4"
} as const;

const ERASE_SCROLLBACK_SEQUENCES = [
  new Uint8Array([0x1b, 0x5b, 0x33, 0x4a]),
  new Uint8Array([0x9b, 0x33, 0x4a])
] as const;

export type TerminalRuntime = {
  tabId: string;
  sessionId?: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  dataChannel?: Channel<SshDataEvent>;
  disposables: Array<{ dispose: () => void }>;
  mounted: boolean;
};

class TerminalRegistry {
  private runtimes = new Map<string, TerminalRuntime>();
  private pendingWrites = new Map<string, Array<Uint8Array | string>>();
  private pendingWriteBytes = new Map<string, number>();
  private flushTimers = new Map<string, number>();
  private writingTabs = new Set<string>();
  private catchingUpTabs = new Set<string>();
  private terminalVisibility = new Map<string, string>();
  private escapeSequenceTails = new Map<string, Uint8Array>();
  private windowActive = document.hasFocus() && document.visibilityState === "visible";
  private terminalSettings: TerminalSettingsDto = defaultTerminalSettings;
  private readonly maxBytesPerFlush = 32 * 1024;
  private readonly maxPendingBytes = 4 * 1024 * 1024;
  private readonly minLetterSpacing = -1;
  private readonly maxLetterSpacing = 1;

  constructor() {
    window.addEventListener("blur", this.handleWindowBlur);
    window.addEventListener("focus", this.handleWindowFocus);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  private handleWindowBlur = () => {
    this.windowActive = false;
    for (const tabId of this.runtimes.keys()) {
      this.clearFlushTimer(tabId);
    }
  };

  private handleWindowFocus = () => {
    if (document.visibilityState !== "visible") return;
    this.resumeWindowOutput();
  };

  private handleVisibilityChange = () => {
    if (document.visibilityState === "visible" && document.hasFocus()) {
      this.resumeWindowOutput();
      return;
    }

    this.handleWindowBlur();
  };

  private resumeWindowOutput() {
    if (this.windowActive) return;
    this.windowActive = true;

    for (const [tabId, runtime] of this.runtimes) {
      const pending = this.pendingWrites.get(tabId);
      if (!runtime.mounted || !pending?.length) continue;

      const element = runtime.terminal.element;
      if (element) {
        this.terminalVisibility.set(tabId, element.style.visibility);
        element.style.visibility = "hidden";
      }
      this.catchingUpTabs.add(tabId);
      this.flushPendingWrites(tabId);
    }
  }

  private normalizeLetterSpacing(value: number) {
    return Math.min(this.maxLetterSpacing, Math.max(this.minLetterSpacing, value));
  }

  create(tabId: string, settings: TerminalSettingsDto = this.terminalSettings): TerminalRuntime {
    const letterSpacing = this.normalizeLetterSpacing(settings.letterSpacing);
    const terminal = new Terminal({
      cursorBlink: settings.cursorBlink,
      convertEol: false,
      scrollback: settings.scrollback,
      fontSize: settings.fontSize,
      fontFamily: settings.fontFamily,
      fontWeight: settings.fontWeight,
      fontWeightBold: settings.fontWeightBold,
      lineHeight: settings.lineHeight,
      letterSpacing,
      theme: DEFAULT_TERMINAL_THEME,
      allowProposedApi: false
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    const runtime: TerminalRuntime = {
      tabId,
      terminal,
      fitAddon,
      dataChannel: undefined,
      disposables: [],
      mounted: false
    };

    this.runtimes.set(tabId, runtime);
    this.flushPendingWrites(tabId);
    return runtime;
  }

  applySettings(settings: TerminalSettingsDto) {
    this.terminalSettings = settings;
    const letterSpacing = this.normalizeLetterSpacing(settings.letterSpacing);

    for (const runtime of this.runtimes.values()) {
      if (runtime.terminal.element) {
        runtime.terminal.element.style.fontFamily = settings.fontFamily;
      }

      runtime.terminal.options.cursorBlink = settings.cursorBlink;
      runtime.terminal.options.scrollback = settings.scrollback;
      runtime.terminal.options.fontSize = settings.fontSize;
      runtime.terminal.options.fontFamily = settings.fontFamily;
      runtime.terminal.options.fontWeight = settings.fontWeight;
      runtime.terminal.options.fontWeightBold = settings.fontWeightBold;
      runtime.terminal.options.lineHeight = settings.lineHeight;
      runtime.terminal.options.letterSpacing = letterSpacing;

      runtime.terminal.clearTextureAtlas();
      runtime.terminal.refresh(0, Math.max(0, runtime.terminal.rows - 1));
      this.fitAndResizeRuntime(runtime);
    }
  }

  get(tabId: string) {
    return this.runtimes.get(tabId);
  }

  bindSession(tabId: string, sessionId: string) {
    const runtime = this.runtimes.get(tabId);
    if (runtime) {
      runtime.sessionId = sessionId;
    }
  }

  getSessionId(tabId: string) {
    return this.runtimes.get(tabId)?.sessionId;
  }

  bindDataChannel(tabId: string, dataChannel: Channel<SshDataEvent>) {
    const runtime = this.runtimes.get(tabId);
    if (runtime) {
      runtime.dataChannel = dataChannel;
    }
  }

  writeByTabId(tabId: string, data: Uint8Array | string) {
    data = this.preserveScrollback(tabId, data);
    if (data.length === 0) return;

    const pending = this.pendingWrites.get(tabId) ?? [];
    pending.push(data);
    this.pendingWrites.set(tabId, pending);

    const dataBytes = typeof data === "string" ? data.length : data.byteLength;
    const totalBytes = (this.pendingWriteBytes.get(tabId) ?? 0) + dataBytes;
    this.pendingWriteBytes.set(tabId, totalBytes);

    if (totalBytes > this.maxPendingBytes) {
      this.dropOldestPendingWrites(tabId, totalBytes - this.maxPendingBytes);
    }

    this.scheduleFlush(tabId);
  }

  fit(tabId: string) {
    this.runtimes.get(tabId)?.fitAddon.fit();
  }

  fitAndResize(tabId: string) {
    const runtime = this.runtimes.get(tabId);
    if (!runtime) return;
    this.fitAndResizeRuntime(runtime);
  }

  flush(tabId: string) {
    this.scheduleFlush(tabId);
  }

  dispose(tabId: string) {
    const runtime = this.runtimes.get(tabId);
    if (!runtime) return;

    runtime.dataChannel = undefined;
    runtime.disposables.forEach((disposable) => disposable.dispose());
    runtime.terminal.dispose();
    this.runtimes.delete(tabId);
    this.pendingWrites.delete(tabId);
    this.pendingWriteBytes.delete(tabId);
    this.writingTabs.delete(tabId);
    this.catchingUpTabs.delete(tabId);
    this.terminalVisibility.delete(tabId);
    this.escapeSequenceTails.delete(tabId);
    this.clearFlushTimer(tabId);
  }

  private scheduleFlush(tabId: string) {
    if (!this.windowActive) return;
    if (this.flushTimers.has(tabId)) return;

    const timer = window.requestAnimationFrame(() => {
      this.flushTimers.delete(tabId);
      this.flushPendingWrites(tabId);
    });

    this.flushTimers.set(tabId, timer);
  }

  private clearFlushTimer(tabId: string) {
    const timer = this.flushTimers.get(tabId);
    if (timer !== undefined) {
      window.cancelAnimationFrame(timer);
      this.flushTimers.delete(tabId);
    }
  }

  private flushPendingWrites(tabId: string) {
    const runtime = this.runtimes.get(tabId);
    if (!runtime?.mounted) return;
    if (this.writingTabs.has(tabId)) return;

    const pending = this.pendingWrites.get(tabId);
    if (!pending || pending.length === 0) return;

    const chunk = this.catchingUpTabs.has(tabId)
      ? this.mergePendingWrites(pending)
      : pending[0];
    const chunkLength = typeof chunk === "string" ? chunk.length : chunk.byteLength;

    let writeChunk: Uint8Array | string = chunk;
    if (chunkLength > this.maxBytesPerFlush) {
      if (typeof chunk === "string") {
        writeChunk = chunk.slice(0, this.maxBytesPerFlush);
        pending[0] = chunk.slice(this.maxBytesPerFlush);
      } else {
        writeChunk = chunk.subarray(0, this.maxBytesPerFlush);
        pending[0] = chunk.subarray(this.maxBytesPerFlush);
      }
    } else {
      pending.shift();
    }

    const writeBytes = typeof writeChunk === "string" ? writeChunk.length : writeChunk.byteLength;
    this.pendingWriteBytes.set(tabId, Math.max(0, (this.pendingWriteBytes.get(tabId) ?? 0) - writeBytes));

    this.writingTabs.add(tabId);
    const handleWriteComplete = () => {
      this.writingTabs.delete(tabId);
      const latestRuntime = this.runtimes.get(tabId);
      if (!latestRuntime?.mounted) {
        this.pendingWrites.delete(tabId);
        this.pendingWriteBytes.delete(tabId);
        this.finishCatchUp(tabId);
        return;
      }

      const remaining = this.pendingWrites.get(tabId);
      if (!remaining || remaining.length === 0) {
        this.pendingWrites.delete(tabId);
        this.pendingWriteBytes.delete(tabId);
        this.finishCatchUp(tabId);
        return;
      }

      if (this.catchingUpTabs.has(tabId)) {
        this.flushPendingWrites(tabId);
      } else {
        this.scheduleFlush(tabId);
      }
    };

    try {
      runtime.terminal.write(writeChunk, () => {
        handleWriteComplete();
      });
    } catch (error) {
      console.error("[wmcssh][terminal] terminal.write failed", error);
      handleWriteComplete();
    }
  }

  private mergePendingWrites(pending: Array<Uint8Array | string>): Uint8Array | string {
    if (pending.every((item) => typeof item === "string")) {
      const merged = (pending as string[]).join("");
      pending.splice(0, pending.length, merged);
      return merged;
    }

    if (pending.every((item) => item instanceof Uint8Array)) {
      const byteChunks = pending as Uint8Array[];
      const totalBytes = byteChunks.reduce((sum, item) => sum + item.byteLength, 0);
      const merged = new Uint8Array(totalBytes);
      let offset = 0;
      for (const item of byteChunks) {
        merged.set(item, offset);
        offset += item.byteLength;
      }
      pending.splice(0, pending.length, merged);
      return merged;
    }

    return pending[0];
  }

  private finishCatchUp(tabId: string) {
    if (!this.catchingUpTabs.delete(tabId)) return;

    const runtime = this.runtimes.get(tabId);
    const element = runtime?.terminal.element;
    if (element) {
      element.style.visibility = this.terminalVisibility.get(tabId) ?? "";
    }
    this.terminalVisibility.delete(tabId);
    if (runtime?.mounted) {
      runtime.terminal.refresh(0, Math.max(0, runtime.terminal.rows - 1));
    }
  }

  private preserveScrollback(tabId: string, data: Uint8Array | string): Uint8Array | string {
    if (typeof data === "string") {
      return data.split("\u001b[3J").join("").split("\u009b3J").join("");
    }

    const tail = this.escapeSequenceTails.get(tabId);
    const combined = new Uint8Array((tail?.byteLength ?? 0) + data.byteLength);
    if (tail) combined.set(tail, 0);
    combined.set(data, tail?.byteLength ?? 0);

    let retainedBytes = 0;
    for (const sequence of ERASE_SCROLLBACK_SEQUENCES) {
      for (let length = 1; length < sequence.byteLength; length += 1) {
        if (length > combined.byteLength) break;
        const offset = combined.byteLength - length;
        let matches = true;
        for (let index = 0; index < length; index += 1) {
          if (combined[offset + index] !== sequence[index]) {
            matches = false;
            break;
          }
        }
        if (matches) retainedBytes = Math.max(retainedBytes, length);
      }
    }

    const processLength = combined.byteLength - retainedBytes;
    const output = combined.slice(0, processLength);
    for (const sequence of ERASE_SCROLLBACK_SEQUENCES) {
      for (let offset = 0; offset <= output.byteLength - sequence.byteLength; offset += 1) {
        let matches = true;
        for (let index = 0; index < sequence.byteLength; index += 1) {
          if (output[offset + index] !== sequence[index]) {
            matches = false;
            break;
          }
        }
        if (matches) output.fill(0, offset, offset + sequence.byteLength);
      }
    }

    if (retainedBytes > 0) {
      this.escapeSequenceTails.set(tabId, combined.slice(processLength));
    } else {
      this.escapeSequenceTails.delete(tabId);
    }
    return output;
  }

  private dropOldestPendingWrites(tabId: string, bytesToDrop: number) {
    const pending = this.pendingWrites.get(tabId);
    if (!pending || pending.length === 0) return;

    let remainingDrop = bytesToDrop;
    while (remainingDrop > 0 && pending.length > 0) {
      const oldest = pending[0];
      const oldestBytes = typeof oldest === "string" ? oldest.length : oldest.byteLength;

      if (oldestBytes <= remainingDrop) {
        pending.shift();
        remainingDrop -= oldestBytes;
        continue;
      }

      if (typeof oldest === "string") {
        pending[0] = oldest.slice(remainingDrop);
      } else {
        pending[0] = oldest.subarray(remainingDrop);
      }
      remainingDrop = 0;
    }

    const totalBytes = pending.reduce(
      (sum, item) => sum + (typeof item === "string" ? item.length : item.byteLength),
      0
    );
    this.pendingWriteBytes.set(tabId, totalBytes);
    console.warn("[wmcssh][terminal] output queue high water mark; dropped oldest output", {
      tabId,
      totalBytes
    });
  }

  private fitAndResizeRuntime(runtime: TerminalRuntime) {
    if (!runtime.mounted) return;
    if (!this.isVisible(runtime)) return;

    runtime.fitAddon.fit();
    if (runtime.sessionId) {
      void sshResize({
        sessionId: runtime.sessionId,
        cols: runtime.terminal.cols,
        rows: runtime.terminal.rows
      });
    }
  }

  private isVisible(runtime: TerminalRuntime) {
    const element = runtime.terminal.element;
    if (!element) return false;
    if (element.offsetParent === null) return false;
    return element.clientWidth > 0 && element.clientHeight > 0;
  }
}

export const terminalRegistry = new TerminalRegistry();
