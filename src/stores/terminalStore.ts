import { create } from "zustand";
import type { HostId, SessionId, TabId } from "../types/common";
import type { SessionStatus } from "../types/ssh";
import type { AppErrorCode } from "../types/errors";

export type TabStatus = SessionStatus | "created";
export type WorkspaceTabKind = "terminal" | "file-transfer";

type WorkspaceTabBase = {
  tabId: TabId;
  hostId: HostId;
  title: string;
  createdAt: number;
  lastActiveAt: number;
  pinned?: boolean;
  dirty?: boolean;
};

export type TerminalTab = WorkspaceTabBase & {
  kind: "terminal";
  port: number;
  remoteTitle?: string;
  currentDirectory?: string;
  sessionId?: SessionId;
  status: TabStatus;
  errorMessage?: string;
  errorCode?: AppErrorCode;
  errorDetails?: string;
};

export type FileTransferTab = WorkspaceTabBase & {
  kind: "file-transfer";
  initialPath?: string;
  transferSessionId?: SessionId;
};

export type WorkspaceTab = TerminalTab | FileTransferTab;

type TerminalStore = {
  tabs: WorkspaceTab[];
  activeTabId?: TabId;
  createTerminalTab: (input: { hostId: HostId; title: string; port: number; afterTabId?: TabId }) => TabId;
  createFileTransferTab: (input: { hostId: HostId; title: string; afterTabId?: TabId; initialPath?: string }) => TabId;
  setTerminalMetadata: (tabId: TabId, metadata: { remoteTitle?: string; currentDirectory?: string }) => void;
  bindSession: (tabId: TabId, sessionId: SessionId) => void;
  bindFileTransferSession: (tabId: TabId, transferSessionId: SessionId) => void;
  replaceSession: (tabId: TabId, newSessionId: SessionId) => void;
  setTabStatus: (tabId: TabId, status: TabStatus, errorMessage?: string, errorCode?: AppErrorCode, errorDetails?: string) => void;
  setActiveTab: (tabId: TabId) => void;
  moveTab: (tabId: TabId, targetTabId: TabId, after: boolean) => void;
  markClosing: (tabId: TabId) => void;
  removeTab: (tabId: TabId) => void;
  findTabBySessionId: (sessionId: SessionId) => TerminalTab | undefined;
};

function newTabId() {
  return crypto.randomUUID();
}

function insertTab(tabs: WorkspaceTab[], tab: WorkspaceTab, afterTabId?: TabId) {
  const index = afterTabId ? tabs.findIndex((item) => item.tabId === afterTabId) : -1;
  if (index < 0) return [...tabs, tab];
  return [...tabs.slice(0, index + 1), tab, ...tabs.slice(index + 1)];
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  tabs: [],
  activeTabId: undefined,

  createTerminalTab(input) {
    const now = Date.now();
    const tabId = newTabId();
    const tab: TerminalTab = {
      kind: "terminal",
      tabId,
      hostId: input.hostId,
      title: input.title,
      port: input.port,
      status: "created",
      createdAt: now,
      lastActiveAt: now
    };

    set((state) => ({
      tabs: insertTab(state.tabs, tab, input.afterTabId),
      activeTabId: tabId
    }));

    return tabId;
  },

  createFileTransferTab(input) {
    const now = Date.now();
    const tabId = newTabId();
    const tab: FileTransferTab = {
      kind: "file-transfer",
      initialPath: input.initialPath,
      tabId,
      hostId: input.hostId,
      title: `${input.title} 文件`,
      createdAt: now,
      lastActiveAt: now
    };

    set((state) => ({
      tabs: insertTab(state.tabs, tab, input.afterTabId),
      activeTabId: tabId
    }));

    return tabId;
  },

  setTerminalMetadata(tabId, metadata) {
    set((state) => ({ tabs: state.tabs.map((tab) =>
      tab.tabId === tabId && tab.kind === "terminal" ? { ...tab, ...metadata } : tab
    ) }));
  },

  bindSession(tabId, sessionId) {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.tabId === tabId && tab.kind === "terminal" ? { ...tab, sessionId, remoteTitle: undefined, currentDirectory: undefined } : tab
      )
    }));
  },

  bindFileTransferSession(tabId, transferSessionId) {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.tabId === tabId && tab.kind === "file-transfer" ? { ...tab, transferSessionId } : tab
      )
    }));
  },

  replaceSession(tabId, newSessionId) {
    get().bindSession(tabId, newSessionId);
  },

  setTabStatus(tabId, status, errorMessage, errorCode, errorDetails) {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.tabId === tabId && tab.kind === "terminal" ? { ...tab, status, errorMessage, errorCode, errorDetails } : tab
      )
    }));
  },

  setActiveTab(tabId) {
    set((state) => ({
      activeTabId: tabId,
      tabs: state.tabs.map((tab) =>
        tab.tabId === tabId ? { ...tab, lastActiveAt: Date.now() } : tab
      )
    }));
  },

  moveTab(tabId, targetTabId, after) {
    set((state) => {
      if (tabId === targetTabId) return state;
      const moving = state.tabs.find((tab) => tab.tabId === tabId);
      if (!moving || !state.tabs.some((tab) => tab.tabId === targetTabId)) return state;
      const tabs = state.tabs.filter((tab) => tab.tabId !== tabId);
      const index = tabs.findIndex((tab) => tab.tabId === targetTabId) + (after ? 1 : 0);
      tabs.splice(index, 0, moving);
      return { tabs };
    });
  },

  markClosing(tabId) {
    const tab = get().tabs.find((item) => item.tabId === tabId);
    if (tab?.kind === "terminal") {
      get().setTabStatus(tabId, "closing");
    }
  },

  removeTab(tabId) {
    set((state) => {
      const tabs = state.tabs.filter((tab) => tab.tabId !== tabId);
      const activeTabId =
        state.activeTabId === tabId ? tabs[tabs.length - 1]?.tabId : state.activeTabId;
      return { tabs, activeTabId };
    });
  },

  findTabBySessionId(sessionId) {
    const tab = get().tabs.find((item) => item.kind === "terminal" && item.sessionId === sessionId);
    return tab?.kind === "terminal" ? tab : undefined;
  }
}));
