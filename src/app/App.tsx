import { useCallback, useEffect, useState } from "react";
import { AppShell } from "../features/layout/components/AppShell";
import { useTerminalEvents } from "../features/terminal/hooks/useTerminalEvents";
import { useHostStore } from "../stores/hostStore";
import { useSettingsStore } from "../stores/settingsStore";
import { ConnectionCredentialsDialog } from "../features/hosts/components/ConnectionCredentialsDialog";
import { VaultUnlockDialog } from "../features/vault/VaultUnlockDialog";

export function App() {
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const handleVaultUnlocked = useCallback(() => setVaultUnlocked(true), []);
  useTerminalEvents();
  const loadHosts = useHostStore((state) => state.loadHosts);
  const loadTerminalSettings = useSettingsStore((state) => state.loadTerminalSettings);

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    window.addEventListener("contextmenu", handleContextMenu);

    return () => {
      window.removeEventListener("contextmenu", handleContextMenu);
    };
  }, []);

  useEffect(() => {
    void loadHosts();
  }, [loadHosts]);

  useEffect(() => {
    void loadTerminalSettings();
  }, [loadTerminalSettings]);

  return <><AppShell /><ConnectionCredentialsDialog />{!vaultUnlocked ? <VaultUnlockDialog onUnlocked={handleVaultUnlocked} /> : null}</>;
}
