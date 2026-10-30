import { create } from "zustand";

type TerminalNotice = { id: number; tabId: string; source: string; title: string; body: string; expiresAt: number };
let nextId = 0;
let lastAccepted = -Infinity;
const recent = new Map<string, number>();

export const useTerminalNoticeStore = create<{
  notices: TerminalNotice[];
  push: (notice: Omit<TerminalNotice, "id" | "expiresAt">) => boolean;
  dismiss: (id: number) => void;
}>((set) => ({
  notices: [],
  push(notice) {
    const now = Date.now();
    const key = `${notice.tabId}\0${notice.title}\0${notice.body}`;
    if (now - lastAccepted < 1000 || now - (recent.get(key) ?? -Infinity) < 10000) return false;
    lastAccepted = now;
    for (const [key, time] of recent) if (now - time >= 10000) recent.delete(key);
    recent.set(key, now);
    set((state) => ({ notices: [...state.notices, { ...notice, id: ++nextId, expiresAt: now + 8000 }].slice(-3) }));
    return true;
  },
  dismiss(id) { set((state) => ({ notices: state.notices.filter((notice) => notice.id !== id) })); }
}));
