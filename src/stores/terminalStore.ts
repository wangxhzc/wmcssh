import { create } from "zustand";
import type { HostId, SessionId, TabId } from "../types/common";
import type { SessionStatus } from "../types/ssh";

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
  sessionId?: SessionId;
  status: TabStatus;
  errorMessage?: string;
};

export type FileTransferTab = WorkspaceTabBase & {
  kind: "file-transfer";
  transferSessionId?: SessionId;
};

export type WorkspaceTab = TerminalTab | FileTransferTab;

type TerminalStore = {
  tabs: WorkspaceTab[];
  activeTabId?: TabId;
  createTerminalTab: (input: { hostId: HostId; title: string }) => TabId;
  createFileTransferTab: (input: { hostId: HostId; title: string }) => TabId;
  bindSession: (tabId: TabId, sessionId: SessionId) => void;
  bindFileTransferSession: (tabId: TabId, transferSessionId: SessionId) => void;
  replaceSession: (tabId: TabId, newSessionId: SessionId) => void;
  setTabStatus: (tabId: TabId, status: TabStatus, errorMessage?: string) => void;
  setActiveTab: (tabId: TabId) => void;
  markClosing: (tabId: TabId) => void;
  removeTab: (tabId: TabId) => void;
  findTabBySessionId: (sessionId: SessionId) => TerminalTab | undefined;
};

function newTabId() {
  return crypto.randomUUID();
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
      status: "created",
      createdAt: now,
      lastActiveAt: now
    };

    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tabId
    }));

    return tabId;
  },

  createFileTransferTab(input) {
    const now = Date.now();
    const tabId = newTabId();
    const tab: FileTransferTab = {
      kind: "file-transfer",
      tabId,
      hostId: input.hostId,
      title: `${input.title} 文件`,
      createdAt: now,
      lastActiveAt: now
    };

    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tabId
    }));

    return tabId;
  },

  bindSession(tabId, sessionId) {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.tabId === tabId && tab.kind === "terminal" ? { ...tab, sessionId } : tab
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

  setTabStatus(tabId, status, errorMessage) {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.tabId === tabId && tab.kind === "terminal" ? { ...tab, status, errorMessage } : tab
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
