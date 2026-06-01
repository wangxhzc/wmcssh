import { useEffect } from "react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { AppShell } from "../features/layout/components/AppShell";
import { useTerminalEvents } from "../features/terminal/hooks/useTerminalEvents";
import { useHostStore } from "../stores/hostStore";
import { useSettingsStore } from "../stores/settingsStore";

export function App() {
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
    const resizeWindow = async () => {
      try {
        const appWindow = getCurrentWindow();
        await appWindow.setSize(new LogicalSize(1360, 780));
        await appWindow.setMinSize(new LogicalSize(1280, 720));
      } catch (error) {
        console.debug("[wmcssh][window] failed to apply default size", error);
      }
    };

    void resizeWindow();
  }, []);

  useEffect(() => {
    void loadHosts();
  }, [loadHosts]);

  useEffect(() => {
    void loadTerminalSettings();
  }, [loadTerminalSettings]);

  return <AppShell />;
}
