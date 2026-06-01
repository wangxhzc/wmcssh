import { Channel } from "@tauri-apps/api/core";
import type { HostDto } from "../../types/host";
import type { SshDataEvent } from "../../types/ssh";
import { normalizeAppError } from "../../types/errors";
import { closeFileTransferSession } from "../../services/tauri/fileTransferApi";
import { sshConnect, sshDisconnect } from "../../services/tauri/sshApi";
import { sshWrite } from "../../services/tauri/sshApi";
import { base64ToUint8Array } from "../../services/terminal/terminalCodec";
import { stringToBase64 } from "../../services/terminal/terminalCodec";
import { useTerminalStore } from "../../stores/terminalStore";
import { sessionTabIndex } from "./sessionTabIndex";
import { terminalRegistry } from "./terminalRegistry";

const INPUT_FLUSH_DELAY_MS = 10;
const MAX_INPUT_FLUSH_CHARS = 1024;
const DEFAULT_TERMINAL_COLS = 120;
const DEFAULT_TERMINAL_ROWS = 28;
const TERMINAL_ENTER_INPUTS = new Set(["\r", "\n", "\r\n"]);
const TERMINAL_CTRL_D_INPUT = "\x04";
const pendingInputByTab = new Map<string, string>();
const inputFlushTimers = new Map<string, number>();
const inputFlushInFlight = new Set<string>();
const stoppedInputTabs = new Set<string>();

function isTerminalInputStopped(tabId: string) {
  return stoppedInputTabs.has(tabId);
}

function clearPendingTerminalInput(tabId: string) {
  const timer = inputFlushTimers.get(tabId);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    inputFlushTimers.delete(tabId);
  }
  pendingInputByTab.delete(tabId);
}

function scheduleTerminalInputFlush(tabId: string) {
  if (isTerminalInputStopped(tabId)) {
    clearPendingTerminalInput(tabId);
    return;
  }

  if (inputFlushTimers.has(tabId) || inputFlushInFlight.has(tabId)) {
    return;
  }

  const timer = window.setTimeout(() => {
    void flushTerminalInput(tabId);
  }, INPUT_FLUSH_DELAY_MS);

  inputFlushTimers.set(tabId, timer);
}

export async function flushTerminalInput(tabId: string) {
  const timer = inputFlushTimers.get(tabId);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    inputFlushTimers.delete(tabId);
  }

  if (inputFlushInFlight.has(tabId)) {
    return;
  }

  if (isTerminalInputStopped(tabId)) {
    clearPendingTerminalInput(tabId);
    return;
  }

  const buffered = pendingInputByTab.get(tabId);
  if (!buffered) return;

  const chunk = buffered.slice(0, MAX_INPUT_FLUSH_CHARS);
  const remaining = buffered.slice(MAX_INPUT_FLUSH_CHARS);
  if (remaining) {
    pendingInputByTab.set(tabId, remaining);
  } else {
    pendingInputByTab.delete(tabId);
  }

  const sessionId = terminalRegistry.getSessionId(tabId);
  if (!sessionId) {
    clearPendingTerminalInput(tabId);
    return;
  }

  const tab = useTerminalStore.getState().tabs.find((item) => item.tabId === tabId);
  if (tab?.kind === "terminal" && tab.status !== "connected") {
    clearPendingTerminalInput(tabId);
    return;
  }

  inputFlushInFlight.add(tabId);

  try {
    await sshWrite({
      sessionId,
      dataBase64: stringToBase64(chunk)
    });
  } catch (error: unknown) {
    console.error("[wmcssh][terminal] failed to flush input", error);
    stopTerminalInput(tabId, "ssh_write_failed");

    const appError = normalizeAppError(error);
    if (appError.code === "session_closed" || appError.code === "session_not_found") {
      console.warn("[wmcssh][terminal] stop input after closed session", {
        tabId,
        code: appError.code
      });
    }
  } finally {
    inputFlushInFlight.delete(tabId);
  }

  if (!isTerminalInputStopped(tabId) && pendingInputByTab.has(tabId)) {
    scheduleTerminalInputFlush(tabId);
  }
}

export function stopTerminalInput(tabId: string, reason = "unknown") {
  if (stoppedInputTabs.has(tabId)) return;
  stoppedInputTabs.add(tabId);
  clearPendingTerminalInput(tabId);
  if (reason === "ssh_write_failed") {
    console.warn("[wmcssh][terminal] input stopped", { tabId, reason });
  }
}

export function resumeTerminalInput(tabId: string) {
  stoppedInputTabs.delete(tabId);
}

export function stopTerminalInputBySessionId(sessionId: string, reason = "unknown") {
  const tabId = sessionTabIndex.getTabId(sessionId);
  if (!tabId) return;
  const tab = useTerminalStore.getState().tabs.find((item) => item.tabId === tabId);
  if (!tab || tab.kind !== "terminal" || tab.sessionId !== sessionId) {
    return;
  }
  stopTerminalInput(tabId, reason);
}

export function queueTerminalInput(tabId: string, data: string) {
  const tab = useTerminalStore.getState().tabs.find((item) => item.tabId === tabId);
  if (tab?.kind === "terminal") {
    if (tab.status === "disconnected") {
      stopTerminalInput(tabId, "tab_disconnected");
      if (TERMINAL_ENTER_INPUTS.has(data)) {
        void reconnectTab(tabId);
      } else if (data === TERMINAL_CTRL_D_INPUT) {
        void closeWorkspaceTab(tabId);
      }
      return;
    }

    if (isTerminalInputStopped(tabId)) {
      return;
    }

    if (tab.status !== "connected") {
      clearPendingTerminalInput(tabId);
      return;
    }
  }

  const current = pendingInputByTab.get(tabId) ?? "";
  pendingInputByTab.set(tabId, current + data);

  scheduleTerminalInputFlush(tabId);
}

export async function connectHost(host: HostDto) {
  const store = useTerminalStore.getState();
  const tabId = store.createTerminalTab({ hostId: host.id, title: host.name });

  store.setActiveTab(tabId);
  store.setTabStatus(tabId, "connecting");
  resumeTerminalInput(tabId);

  const onData = new Channel<SshDataEvent>();
  terminalRegistry.bindDataChannel(tabId, onData);
  onData.onmessage = (payload) => {
    const dataBase64 =
      (payload as { data?: { dataBase64?: string; data_base64?: string } }).data?.dataBase64 ??
      (payload as { data?: { dataBase64?: string; data_base64?: string } }).data?.data_base64 ??
      (payload as { dataBase64?: string; data_base64?: string }).dataBase64 ??
      (payload as { dataBase64?: string; data_base64?: string }).data_base64;

    if (!dataBase64) return;
    terminalRegistry.writeByTabId(tabId, base64ToUint8Array(dataBase64));
  };

  try {
    const { sessionId } = await sshConnect(
      { hostId: host.id, initialCols: DEFAULT_TERMINAL_COLS, initialRows: DEFAULT_TERMINAL_ROWS },
      onData
    );

    store.bindSession(tabId, sessionId);
    sessionTabIndex.bind(sessionId, tabId);
    terminalRegistry.bindSession(tabId, sessionId);
  } catch (error) {
    const appError = normalizeAppError(error);
    store.setTabStatus(tabId, "error", appError.message);
  }
}

export async function closeWorkspaceTab(tabId: string) {
  const store = useTerminalStore.getState();
  const tab = store.tabs.find((item) => item.tabId === tabId);
  if (!tab) return;

  if (tab.kind !== "terminal") {
    if (tab.transferSessionId) {
      await closeFileTransferSession({ transferSessionId: tab.transferSessionId }).catch((error) => {
        console.error("[wmcssh][file-transfer] failed to close session", error);
      });
    }
    store.removeTab(tabId);
    return;
  }

  store.markClosing(tabId);
  stopTerminalInput(tabId, "tab_closing");

  try {
    if (tab.sessionId) {
      await sshDisconnect({ sessionId: tab.sessionId });
      sessionTabIndex.unbind(tab.sessionId);
    }
  } finally {
    terminalRegistry.dispose(tabId);
    store.removeTab(tabId);
  }
}

export async function reconnectTab(tabId: string) {
  const store = useTerminalStore.getState();
  const tab = store.tabs.find((item) => item.tabId === tabId);
  if (!tab || tab.kind !== "terminal") return;

  store.setTabStatus(tabId, "reconnecting");
  stopTerminalInput(tabId, "tab_reconnecting");

  const onData = new Channel<SshDataEvent>();
  terminalRegistry.bindDataChannel(tabId, onData);
  onData.onmessage = (payload) => {
    const dataBase64 =
      (payload as { data?: { dataBase64?: string; data_base64?: string } }).data?.dataBase64 ??
      (payload as { data?: { dataBase64?: string; data_base64?: string } }).data?.data_base64 ??
      (payload as { dataBase64?: string; data_base64?: string }).dataBase64 ??
      (payload as { dataBase64?: string; data_base64?: string }).data_base64;

    if (!dataBase64) return;
    terminalRegistry.writeByTabId(tabId, base64ToUint8Array(dataBase64));
  };

  try {
    const oldSessionId = tab.sessionId;
    const { sessionId: newSessionId } = await sshConnect(
      { hostId: tab.hostId, initialCols: DEFAULT_TERMINAL_COLS, initialRows: DEFAULT_TERMINAL_ROWS },
      onData
    );

    store.replaceSession(tabId, newSessionId);
    sessionTabIndex.replace(oldSessionId, newSessionId, tabId);
    terminalRegistry.bindSession(tabId, newSessionId);
    resumeTerminalInput(tabId);
  } catch (error) {
    const appError = normalizeAppError(error);
    store.setTabStatus(tabId, "error", appError.message);
  }
}
