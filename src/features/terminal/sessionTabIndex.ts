class SessionTabIndex {
  private sessionToTab = new Map<string, string>();

  bind(sessionId: string, tabId: string) {
    this.sessionToTab.set(sessionId, tabId);
  }

  unbind(sessionId: string) {
    this.sessionToTab.delete(sessionId);
  }

  getTabId(sessionId: string) {
    return this.sessionToTab.get(sessionId);
  }

  replace(oldSessionId: string | undefined, newSessionId: string, tabId: string) {
    if (oldSessionId) {
      this.sessionToTab.delete(oldSessionId);
    }
    this.sessionToTab.set(newSessionId, tabId);
  }
}

export const sessionTabIndex = new SessionTabIndex();
