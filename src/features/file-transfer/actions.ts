import type { HostDto } from "../../types/host";
import { useTerminalStore } from "../../stores/terminalStore";

export function openFileTransferTab(host: HostDto, afterTabId?: string) {
  const store = useTerminalStore.getState();
  const source = store.tabs.find((tab) => tab.tabId === afterTabId && tab.hostId === host.id);
  const initialPath = source?.kind === "terminal" ? source.currentDirectory : undefined;
  const tabId = store.createFileTransferTab({ hostId: host.id, title: host.name, afterTabId, initialPath });
  store.setActiveTab(tabId);
  return tabId;
}
