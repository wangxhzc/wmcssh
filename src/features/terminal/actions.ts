import { Channel } from "@tauri-apps/api/core";
import type { HostDto } from "../../types/host";
import type { SshDataEvent } from "../../types/ssh";
import { normalizeAppError } from "../../types/errors";
import { closeFileTransferSession } from "../../services/tauri/fileTransferApi";
import { sshConnect, sshDisconnect } from "../../services/tauri/sshApi";
import { sshWrite, sshAckOutput } from "../../services/tauri/sshApi";
import { base64ToUint8Array } from "../../services/terminal/terminalCodec";
import { stringToBase64 } from "../../services/terminal/terminalCodec";
import { useTerminalStore } from "../../stores/terminalStore";
import { sessionTabIndex } from "./sessionTabIndex";
import { terminalRegistry } from "./terminalRegistry";
import { requestConnectionCredentials, type ConnectionCredentials } from "../hosts/connectionCredentials";
import { updateHost } from "../../services/tauri/hostApi";
import { useHostStore } from "../../stores/hostStore";
import { confirmAndTrustHostKey } from "../hosts/hostKeyTrust";

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
    const appError = normalizeAppError(error);
    if (appError.code === "input_buffer_full") {
      // Rejected writes were never accepted by Rust. Keep their order and retry
      // only while this exact connection is still active.
      if (!isTerminalInputStopped(tabId) && terminalRegistry.getSessionId(tabId) === sessionId) {
        pendingInputByTab.set(tabId, chunk + (pendingInputByTab.get(tabId) ?? ""));
        inputFlushTimers.set(tabId, window.setTimeout(() => void flushTerminalInput(tabId), 100));
      }
      return;
    }
    console.error("[wmcssh][terminal] failed to flush input", error);
    stopTerminalInput(tabId, "ssh_write_failed");
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

export async function rememberConnectionCredentials(host: HostDto, credentials: ConnectionCredentials) {
  if (credentials.rememberUsername || credentials.rememberAuth) {
    host = await updateHost(host.id, {
      username: credentials.rememberUsername ? credentials.username?.trim() : undefined,
      authType: credentials.rememberAuth ? credentials.authType : undefined,
      password: credentials.rememberAuth && credentials.authType === "password" && credentials.password
        ? { action: "replace", value: credentials.password }
        : undefined,
      privateKeyPath: credentials.rememberAuth && credentials.authType === "private_key"
        ? credentials.privateKeyPath
        : undefined,
      privateKeyPassphrase: credentials.rememberAuth && credentials.authType === "private_key" && credentials.privateKeyPassphrase
        ? { action: "replace", value: credentials.privateKeyPassphrase }
        : undefined
    });
    await useHostStore.getState().loadHosts();
  }
  return host;
}

function connectInput(hostId: string, credentials: ConnectionCredentials) {
  return {
    hostId,
    initialCols: DEFAULT_TERMINAL_COLS,
    initialRows: DEFAULT_TERMINAL_ROWS,
    username: credentials.username?.trim() || undefined,
    authType: credentials.authType,
    password: credentials.password,
    privateKeyPath: credentials.privateKeyPath,
    privateKeyPassphrase: credentials.privateKeyPassphrase
  };
}

function createTerminalDataChannel(tabId: string) {
  if (!terminalRegistry.get(tabId)) terminalRegistry.create(tabId);
  const channel = new Channel<SshDataEvent>();
  terminalRegistry.bindDataChannel(tabId, channel);
  channel.onmessage = (payload) => {
    const runtime = terminalRegistry.get(tabId);
    if (!runtime || runtime.dataChannel !== channel) return;
    const { sessionId, dataBase64 } = payload.data;
    const bytes = base64ToUint8Array(dataBase64);
    terminalRegistry.writeByTabId(tabId, bytes, () => {
      void sshAckOutput({ sessionId, bytes: bytes.byteLength }).catch((error) => {
        console.error("[wmcssh][terminal] output acknowledgement failed", error);
      });
    });
  };
  return channel;
}

export async function connectHost(host: HostDto, suppliedCredentials?: ConnectionCredentials) {
  const credentials = suppliedCredentials ?? await requestConnectionCredentials(host);
  if (!credentials) return;
  if (!suppliedCredentials) {
    host = await rememberConnectionCredentials(host, credentials);
  }

  const store = useTerminalStore.getState();
  const tabId = store.createTerminalTab({ hostId: host.id, title: host.name });

  store.setActiveTab(tabId);
  store.setTabStatus(tabId, "connecting");
  resumeTerminalInput(tabId);

  const onData = createTerminalDataChannel(tabId);

  try {
    const { sessionId } = await sshConnect(
      connectInput(host.id, credentials),
      onData
    );

    if (!useTerminalStore.getState().tabs.some((tab) => tab.tabId === tabId)) {
      await sshDisconnect({ sessionId });
      return;
    }

    store.bindSession(tabId, sessionId);
    sessionTabIndex.bind(sessionId, tabId);
    terminalRegistry.bindSession(tabId, sessionId);
  } catch (error) {
    const appError = normalizeAppError(error);
    store.setTabStatus(tabId, "error", appError.message, appError.code);
    if (appError.code === "auth_failed" || appError.code === "secret_not_found" || appError.code === "host_invalid") {
      void retryAuthentication(tabId, appError.message);
    }
  }
}

export async function retryAuthentication(tabId: string, message: string) {
  const store = useTerminalStore.getState();
  const tab = store.tabs.find((item) => item.tabId === tabId);
  if (!tab || tab.kind !== "terminal") return;
  const host = useHostStore.getState().hosts.find((item) => item.id === tab.hostId);
  if (!host) return;

  const credentials = await requestConnectionCredentials(host, {
    force: true,
    message: `认证失败：${message}。请重新输入用户名或认证凭据。`
  });
  if (!credentials) return;
  await rememberConnectionCredentials(host, credentials);

  if (tab.sessionId) {
    await sshDisconnect({ sessionId: tab.sessionId }).catch(() => undefined);
    sessionTabIndex.unbind(tab.sessionId);
  }
  store.setTabStatus(tabId, "reconnecting");
  resumeTerminalInput(tabId);
  const onData = createTerminalDataChannel(tabId);

  try {
    const { sessionId } = await sshConnect(connectInput(host.id, credentials), onData);
    if (!useTerminalStore.getState().tabs.some((tab) => tab.tabId === tabId)) {
      await sshDisconnect({ sessionId });
      return;
    }
    store.replaceSession(tabId, sessionId);
    sessionTabIndex.bind(sessionId, tabId);
    terminalRegistry.bindSession(tabId, sessionId);
  } catch (error) {
    const appError = normalizeAppError(error);
    store.setTabStatus(tabId, "error", appError.message, appError.code);
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
  const oldSessionId = tab.sessionId;
  if (oldSessionId) {
    await sshDisconnect({ sessionId: oldSessionId }).catch(() => undefined);
    sessionTabIndex.unbind(oldSessionId);
  }

  const onData = createTerminalDataChannel(tabId);

  try {
    const { sessionId: newSessionId } = await sshConnect(
      { hostId: tab.hostId, initialCols: DEFAULT_TERMINAL_COLS, initialRows: DEFAULT_TERMINAL_ROWS },
      onData
    );

    if (!useTerminalStore.getState().tabs.some((tab) => tab.tabId === tabId)) {
      await sshDisconnect({ sessionId: newSessionId });
      return;
    }

    store.replaceSession(tabId, newSessionId);
    sessionTabIndex.replace(oldSessionId, newSessionId, tabId);
    terminalRegistry.bindSession(tabId, newSessionId);
    resumeTerminalInput(tabId);
  } catch (error) {
    const appError = normalizeAppError(error);
    store.setTabStatus(tabId, "error", appError.message, appError.code);
    if (appError.code === "auth_failed" || appError.code === "secret_not_found" || appError.code === "host_invalid") {
      void retryAuthentication(tabId, appError.message);
    }
  }
}

export async function trustHostKeyAndReconnect(tabId: string) {
  const store = useTerminalStore.getState();
  const tab = store.tabs.find((item) => item.tabId === tabId);
  if (!tab || tab.kind !== "terminal" || !tab.errorCode || !tab.errorMessage) return;
  try {
    const trusted = await confirmAndTrustHostKey(tab.hostId, {
      code: tab.errorCode,
      message: tab.errorMessage,
      details: tab.errorDetails,
      retryable: false
    });
    if (trusted) await reconnectTab(tabId);
  } catch (error) {
    const appError = normalizeAppError(error);
    store.setTabStatus(tabId, "error", appError.message, appError.code, appError.details);
  }
}
