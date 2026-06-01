import { invoke } from "@tauri-apps/api/core";
import type {
  CreateHostInput,
  DuplicateHostInput,
  HostDto,
  HostFilter,
  HostListResult,
  UpdateHostInput
} from "../../types/host";
import { normalizeAppError } from "../../types/errors";

export async function listHosts(filter?: HostFilter): Promise<HostListResult> {
  try {
    return await invoke<HostListResult>("list_hosts", { filter });
  } catch (error) {
    throw normalizeAppError(error);
  }
}

export async function createHost(input: CreateHostInput): Promise<HostDto> {
  try {
    return await invoke<HostDto>("create_host", { input });
  } catch (error) {
    throw normalizeAppError(error);
  }
}

export async function updateHost(hostId: string, input: UpdateHostInput): Promise<HostDto> {
  try {
    return await invoke<HostDto>("update_host", { hostId, input });
  } catch (error) {
    throw normalizeAppError(error);
  }
}

export async function duplicateHost(input: DuplicateHostInput): Promise<HostDto> {
  try {
    return await invoke<HostDto>("duplicate_host", { input });
  } catch (error) {
    throw normalizeAppError(error);
  }
}

export async function deleteHost(hostId: string): Promise<void> {
  try {
    await invoke("delete_host", { hostId });
  } catch (error) {
    throw normalizeAppError(error);
  }
}
