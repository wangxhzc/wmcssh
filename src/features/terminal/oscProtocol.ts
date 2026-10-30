export function cleanTerminalText(value: string, limit = 256): string {
  return value.replace(/[\x00-\x1f\x7f-\x9f]/g, "").trim().slice(0, limit);
}

export function remoteDirectory(data: string): string | undefined {
  if (data.length > 16384 || !data.startsWith("file://")) return;
  try {
    const uri = new URL(data);
    if (uri.protocol !== "file:" || uri.username || uri.password || uri.port || uri.search || uri.hash) return;
    const path = decodeURIComponent(uri.pathname);
    // The URI authority is the remote hostname, never a local filesystem target.
    if (!path.startsWith("/") || /[\x00-\x1f\x7f]/.test(path)) return;
    return path;
  } catch {
    return;
  }
}

export function remoteNotification(code: 9 | 777, data: string): { title: string; body: string } | undefined {
  if (data.length > 8192) return;
  if (code === 9) {
    // OSC 9;4 is a progress extension, not a notification.
    if (/^\d+;/.test(data)) return;
    const body = cleanTerminalText(data, 1024);
    return body ? { title: "终端通知", body } : undefined;
  }
  if (!data.startsWith("notify;")) return;
  const separator = data.indexOf(";", 7);
  if (separator < 0) return;
  const title = cleanTerminalText(data.slice(7, separator));
  const body = cleanTerminalText(data.slice(separator + 1), 1024);
  return title || body ? { title: title || "终端通知", body } : undefined;
}

export function webLink(value: string): string | undefined {
  if (value.length > 8192 || /[\x00-\x20\x7f]/.test(value)) return;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || !url.hostname || url.username || url.password) return;
    return url.href;
  } catch {
    return;
  }
}
