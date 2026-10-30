import type { Terminal } from "@xterm/xterm";
import { useTerminalStore } from "../../stores/terminalStore";
import { useTerminalNoticeStore } from "../../stores/terminalNoticeStore";
import { openWebLink, requestTerminalAttention } from "../../services/tauri/desktopApi";
import { cleanTerminalText, remoteDirectory, remoteNotification, webLink } from "./oscProtocol";

export function activateTerminalLink(event: MouseEvent, uri: string) {
  if (!(event.ctrlKey || event.metaKey)) return;
  const url = webLink(uri);
  if (!url) return;
  event.preventDefault();
  void openWebLink(url).catch(() => console.error("[wmcssh][terminal] could not open web link"));
}

export function installTerminalIntegration(terminal: Terminal, tabId: string) {
  const disposables = [
    terminal.onTitleChange((title) => {
      useTerminalStore.getState().setTerminalMetadata(tabId, { remoteTitle: cleanTerminalText(title) });
    }),
    terminal.parser.registerOscHandler(7, (data) => {
      const currentDirectory = remoteDirectory(data);
      if (currentDirectory !== undefined) useTerminalStore.getState().setTerminalMetadata(tabId, { currentDirectory });
      return true;
    }),
    ...([9, 777] as const).map((code) => terminal.parser.registerOscHandler(code, (data) => {
      const notification = remoteNotification(code, data);
      const tab = useTerminalStore.getState().tabs.find((tab) => tab.tabId === tabId);
      if (notification && tab) {
        const accepted = useTerminalNoticeStore.getState().push({ ...notification, tabId, source: tab.title });
        if (accepted && (!document.hasFocus() || document.visibilityState !== "visible")) {
          void requestTerminalAttention().catch(() => console.error("[wmcssh][terminal] could not request attention"));
        }
      }
      return true;
    }))
  ];
  return { dispose: () => disposables.forEach((item) => item.dispose()) };
}
