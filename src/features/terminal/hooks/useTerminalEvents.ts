import { useEffect } from "react";
import { listenSshClosed, listenSshError, listenSshStatus } from "../../../services/tauri/eventBus";
import { useTerminalStore } from "../../../stores/terminalStore";
import { stopTerminalInputBySessionId } from "../actions";

export function useTerminalEvents() {
  const setTabStatus = useTerminalStore((state) => state.setTabStatus);

  useEffect(() => {
    const disposers: Array<() => void> = [];

    void listenSshStatus((payload) => {
      const tab = useTerminalStore.getState().findTabBySessionId(payload.sessionId);
      if (!tab) return;

      setTabStatus(tab.tabId, payload.status, payload.message);
    }).then((dispose) => disposers.push(dispose));

    void listenSshClosed((payload) => {
      const tab = useTerminalStore.getState().findTabBySessionId(payload.sessionId);
      if (!tab) return;

      stopTerminalInputBySessionId(payload.sessionId, "ssh_closed_event");
      setTabStatus(tab.tabId, "disconnected", payload.message);
    }).then((dispose) => disposers.push(dispose));

    void listenSshError((payload) => {
      const tab = useTerminalStore.getState().findTabBySessionId(payload.sessionId);
      if (!tab) return;

      stopTerminalInputBySessionId(payload.sessionId, "ssh_error_event");
      setTabStatus(tab.tabId, "error", payload.error.message);
    }).then((dispose) => disposers.push(dispose));

    return () => {
      disposers.forEach((dispose) => dispose());
    };
  }, [setTabStatus]);
}
