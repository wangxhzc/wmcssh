import type { HostDto } from "../../types/host";

export type QuickConnectTarget = {
  hostname: string;
  username?: string;
  port: number;
};

export function parseQuickConnectCommand(value: string): QuickConnectTarget {
  const command = value.trim();
  const match = /^ssh\s+(?:(?<username>[^@\s]+)@)?(?<hostname>[^\s:@]+)(?::(?<port>\d+))?$/i.exec(command);

  if (!match?.groups?.hostname) {
    throw new Error("请输入 ssh 10.0.0.1 或 ssh root@10.0.0.1");
  }

  const port = match.groups.port ? Number(match.groups.port) : 22;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SSH 端口必须在 1 到 65535 之间");
  }

  return {
    hostname: match.groups.hostname,
    username: match.groups.username,
    port
  };
}

export function findMatchingQuickConnectHost(hosts: HostDto[], target: QuickConnectTarget) {
  const normalizedHostname = target.hostname.toLocaleLowerCase();
  return hosts.find((host) =>
    host.hostname.toLocaleLowerCase() === normalizedHostname && host.port === target.port
  );
}
