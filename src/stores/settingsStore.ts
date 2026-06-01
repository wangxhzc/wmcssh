import { create } from "zustand";
import type { TerminalSettingsDto } from "../types/settings";
import { defaultTerminalSettings } from "../types/settings";
import {
  getTerminalSettings,
  resetTerminalSettings as resetTerminalSettingsApi,
  updateTerminalSettings as updateTerminalSettingsApi
} from "../services/tauri/settingsApi";
import { terminalRegistry } from "../features/terminal/terminalRegistry";

type SettingsStore = {
  terminalSettings: TerminalSettingsDto;
  loading: boolean;
  loaded: boolean;
  loadTerminalSettings: () => Promise<void>;
  updateTerminalSettings: (input: TerminalSettingsDto) => Promise<TerminalSettingsDto>;
  resetTerminalSettings: () => Promise<TerminalSettingsDto>;
};

export const useSettingsStore = create<SettingsStore>((set) => ({
  terminalSettings: defaultTerminalSettings,
  loading: false,
  loaded: false,

  async loadTerminalSettings() {
    set({ loading: true });
    try {
      const settings = await getTerminalSettings();
      set({ terminalSettings: settings, loaded: true });
      terminalRegistry.applySettings(settings);
    } finally {
      set({ loading: false });
    }
  },

  async updateTerminalSettings(input) {
    set({ loading: true });
    try {
      const settings = await updateTerminalSettingsApi(input);
      set({ terminalSettings: settings, loaded: true });
      terminalRegistry.applySettings(settings);
      return settings;
    } finally {
      set({ loading: false });
    }
  },

  async resetTerminalSettings() {
    set({ loading: true });
    try {
      const settings = await resetTerminalSettingsApi();
      set({ terminalSettings: settings, loaded: true });
      terminalRegistry.applySettings(settings);
      return settings;
    } finally {
      set({ loading: false });
    }
  }
}));
