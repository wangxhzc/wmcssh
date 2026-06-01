import { create } from "zustand";
import type { CreateHostInput, HostDto, HostFilter } from "../types/host";
import { createHost, listHosts } from "../services/tauri/hostApi";

type HostStore = {
  hosts: HostDto[];
  loading: boolean;
  keyword: string;
  selectedGroupId?: string;
  loadHosts: () => Promise<void>;
  createHost: (input: CreateHostInput) => Promise<HostDto>;
  setKeyword: (keyword: string) => void;
  setSelectedGroupId: (groupId?: string) => void;
};

export const useHostStore = create<HostStore>((set, get) => ({
  hosts: [],
  loading: false,
  keyword: "",

  async loadHosts() {
    set({ loading: true });
    try {
      const filter: HostFilter = {
        keyword: get().keyword || undefined,
        groupId: get().selectedGroupId
      };
      const result = await listHosts(filter);
      set({ hosts: result.hosts });
    } finally {
      set({ loading: false });
    }
  },

  async createHost(input) {
    const host = await createHost(input);
    set((state) => ({ hosts: [host, ...state.hosts] }));
    return host;
  },

  setKeyword(keyword) {
    set({ keyword });
  },

  setSelectedGroupId(groupId) {
    set({ selectedGroupId: groupId });
  }
}));
