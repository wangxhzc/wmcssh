import type { AuthType, HostDto } from "../../types/host";

export type ConnectionCredentials = {
  username?: string;
  rememberUsername: boolean;
  authType?: AuthType;
  password?: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
  rememberAuth: boolean;
};

export const CONNECTION_CREDENTIALS_EVENT = "wmcssh:request-connection-credentials";

export function requestConnectionCredentials(host: HostDto, options?: { force?: boolean; message?: string }): Promise<ConnectionCredentials | null> {
  const needsUsername = !host.username.trim();
  const needsAuth = host.authType === "password" ? !host.hasPassword : !host.privateKeyPath;
  if (!options?.force && !needsUsername && !needsAuth) return Promise.resolve({ rememberUsername: false, rememberAuth: false });

  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent(CONNECTION_CREDENTIALS_EVENT, { detail: { host, resolve, force: options?.force, message: options?.message } }));
  });
}
