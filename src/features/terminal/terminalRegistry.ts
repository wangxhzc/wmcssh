import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { Channel } from "@tauri-apps/api/core";
import type { TerminalSettingsDto } from "../../types/settings";
import type { SshDataEvent } from "../../types/ssh";
import { defaultTerminalSettings } from "../../types/settings";
import { sshResize } from "../../services/tauri/sshApi";

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
  private terminalSettings: TerminalSettingsDto = defaultTerminalSettings;
  private readonly maxBytesPerFlush = 32 * 1024;
  private readonly maxPendingBytes = 4 * 1024 * 1024;
  private readonly minLetterSpacing = -1;
  private readonly maxLetterSpacing = 1;

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
    this.clearFlushTimer(tabId);
  }

  private scheduleFlush(tabId: string) {
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

    const chunk = pending[0];
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
        return;
      }

      const remaining = this.pendingWrites.get(tabId);
      if (!remaining || remaining.length === 0) {
        this.pendingWrites.delete(tabId);
        this.pendingWriteBytes.delete(tabId);
        return;
      }

      this.scheduleFlush(tabId);
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
