import type { HostDto } from "../../types/host";
import { useTerminalStore } from "../../stores/terminalStore";

export function openFileTransferTab(host: HostDto) {
  const store = useTerminalStore.getState();
  const tabId = store.createFileTransferTab({ hostId: host.id, title: host.name });
  store.setActiveTab(tabId);
  return tabId;
}
