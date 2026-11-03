import type { IBufferLine, IDisposable, IMarker, Terminal } from "@xterm/xterm";

export const highlightColors = {
  error: "#E8A0A0", warning: "#E8CF9A", success: "#A4D4B8",
  address: "#A0DAE4", path: "#A0C4F0", metadata: "#B6B6B6"
} as const;

type HighlightRule = {
  pattern: RegExp;
  color: string | ((value: string) => string);
  capture?: number;
  valid?: (value: string) => boolean;
  parts?: (match: RegExpMatchArray) => Array<{ offset: number; length: number; color: string }>;
};

function validIpv4(value: string) {
  return value.split(".").every((part) => Number(part) <= 255);
}

function endpointParts(match: RegExpMatchArray) {
  const hostOffset = match[0].startsWith("[") ? 1 : 0;
  const portOffset = hostOffset + match[1].length + (hostOffset ? 2 : 1);
  const parts: Array<{ offset: number; length: number; color: string }> = [
    { offset: hostOffset, length: match[1].length, color: highlightColors.address },
    { offset: portOffset, length: match[2].length, color: highlightColors.metadata }
  ];
  if (match[3]) parts.push({ offset: portOffset + match[2].length, length: match[3].length, color: highlightColors.path });
  return parts;
}

function addressPathParts(match: RegExpMatchArray) {
  return [
    { offset: 0, length: match[1].length, color: highlightColors.address },
    { offset: match[1].length, length: match[2].length, color: highlightColors.path }
  ];
}

function validIpv6(value: string) {
  try {
    // URL's IPv6 parser also validates compression and embedded IPv4 addresses.
    new URL(`http://[${value.split("%")[0]}]/`);
    return true;
  } catch { return false; }
}

function uriParts(match: RegExpMatchArray) {
  const value = match[0].replace(/[),.;]+$/, "");
  const parsed = /^([a-z][a-z\d+.-]*:\/\/)([^/?#]*)(.*)$/i.exec(value);
  if (!parsed) return [];
  const [, prefix, authority, path] = parsed;
  try {
    // Validate using the platform parser, but retain raw offsets/default ports.
    new URL(value);
  } catch { return []; }
  const parts: Array<{ offset: number; length: number; color: string }> = [
    { offset: 0, length: prefix.length, color: highlightColors.metadata }
  ];
  if (authority) {
    const host = /^(?:(.*)@)?(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(authority);
    if (!host) return [];
    const [, credentials, hostname, port] = host;
    if (port !== undefined && Number(port) > 65535) return [];
    if (/^(?:\d+\.){3}\d+$/.test(hostname) && !validIpv4(hostname)) return [];
    const hostOffset = prefix.length + (credentials === undefined ? 0 : credentials.length + 1);
    if (credentials !== undefined) parts.push({ offset: prefix.length, length: credentials.length + 1, color: highlightColors.metadata });
    parts.push({ offset: hostOffset, length: hostname.length, color: highlightColors.address });
    if (port !== undefined) parts.push({ offset: hostOffset + hostname.length + 1, length: port.length, color: highlightColors.metadata });
  } else if (prefix.toLowerCase() !== "file://") {
    return [];
  }
  if (path) parts.push({ offset: prefix.length + authority.length, length: path.length, color: highlightColors.path });
  return parts;
}

const colors = highlightColors;
const rules: HighlightRule[] = [
  // Composite tokens go first so their contents cannot acquire conflicting colors.
  { pattern: /(?<![\w+.-])[a-z][a-z\d+.-]*:\/\/[^\s<>"'`]+/gi, color: colors.path, parts: uriParts },
  { pattern: /(?<![\w.:/])((?:\d{1,3}\.){3}\d{1,3}):(\d{1,5})(\/[^\s<>"'`|;,()\[\]{}]*)?(?![\w.:/])/g,
    color: colors.address, parts: endpointParts,
    valid: (value) => {
      const [host, port] = value.split("/")[0].split(":");
      return validIpv4(host) && Number(port) <= 65535;
    } },
  { pattern: /\[([\da-f:.]+(?:%[\w.-]+)?)\]:(\d{1,5})(\/[^\s<>"'`|;,()\[\]{}]*)?(?![\w.:/])/gi,
    color: colors.address, parts: endpointParts,
    valid: (value) => {
      const end = value.indexOf("]");
      return validIpv6(value.slice(1, end)) && Number(value.slice(end + 2).split("/")[0]) <= 65535;
    } },
  { pattern: /(?<![\w.:/])((?:\d{1,3}\.){3}\d{1,3})(\/[^\s<>"'`|;,()\[\]{}]*)(?![\w.:/])/g,
    color: colors.address, parts: addressPathParts,
    valid: (value) => {
      const [host, path] = value.split("/");
      // /24 is CIDR, not a path; let the address rule validate its prefix length.
      return validIpv4(host) && !/^\d+$/.test(path);
    } },
  { pattern: /(?<![\w.:/])(localhost|(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z][a-z\d-]{0,62}):(\d{1,5})(\/[^\s<>"'`|;,()\[\]{}]*)?(?![\w.:/])/gi,
    color: colors.address, parts: endpointParts,
    valid: (value) => Number(value.split("/")[0].split(":")[1]) <= 65535 },
  { pattern: /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:\d{2})?\b/g, color: colors.metadata },
  { pattern: /\b(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}(?:\s+[A-Z]{2,5})?(?:\s+\d{4})?\b/g, color: colors.metadata },
  { pattern: /\b\d{4}-\d{2}-\d{2}\b|(?<![\w:])\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?![\w:])/g, color: colors.metadata },
  { pattern: /\b(?:[\da-f]{2}:){5}[\da-f]{2}\b/gi, color: colors.metadata },
  { pattern: /(?<![\w:.])(?:[\da-f]{0,4}:){2,}[\da-f:.]*(?:%[\w.-]+)?(?:\/\d{1,3})?(?![\w:])/gi, color: colors.address,
    valid: (value) => {
      const [address, prefix] = value.split("/");
      return validIpv6(address) && (prefix === undefined || Number(prefix) <= 128);
    } },
  { pattern: /(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?(?![\w./])/g, color: colors.address,
    valid: (value) => {
      const [address, prefix] = value.split("/");
      return validIpv4(address)
        && (prefix === undefined || Number(prefix) <= 32);
    } },
  { pattern: /\b[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}\b/gi, color: colors.metadata },
  { pattern: /(?<![\w:/.])(?:~\/|\/|\.\.?\/)[^\s<>"'`|;,()\[\]{}]+/g, color: colors.path },
  { pattern: /^(?:[bcdlps-])(?:[r-][w-][xSsTt-]){3}[.+@]?(?=\s)/g, color: colors.address },
  { pattern: /\b(?:ERROR|ERR|FATAL|CRIT|CRITICAL|ALERT|EMERG|EMERGENCY|FAILED|FAILURE|FAIL|PANIC|EXCEPTION|OOMKilled|CrashLoopBackOff|ImagePullBackOff|ErrImagePull|CreateContainerConfigError)\b/gi, color: colors.error },
  { pattern: /\b(?:permission denied|access denied|connection refused|connection reset|no such file or directory|command not found|no space left on device|read-only file system|segmentation fault|destination host unreachable|network is unreachable|timed out|unknown host|name or service not known)\b/gi, color: colors.error },
  { pattern: /\b(?:WARN|WARNING|DEPRECATED|PENDING|WAITING|RETRY|RETRYING|TIMEOUT|ContainerCreating|Terminating|NotReady)\b/gi, color: colors.warning },
  { pattern: /\b(?:SUCCESS|SUCCESSFUL|SUCCEEDED|PASSED|PASS|OK|COMPLETED)\b/gi, color: colors.success },
  { pattern: /\b(?:active|running|ready|enabled|healthy|available|reachable|established|ESTAB|CONNECTED|UP|LOWER_UP)\b/gi, color: colors.success },
  { pattern: /\b(?:inactive|disabled|stopped|dead|unhealthy|unreachable|disconnected|exited|paused|restarting|DOWN|NO-CARRIER)\b/gi, color: colors.warning },
  { pattern: /\b(?:activating|deactivating|reloading|UNKNOWN|DORMANT|SYN-SENT|SYN-RECV|SYN_SENT|SYN_RECV|TIME-WAIT|TIME_WAIT|CLOSE-WAIT|CLOSE_WAIT|FIN-WAIT-1|FIN-WAIT-2)\b/gi, color: colors.warning },
  { pattern: /\b(?:INFO|NOTICE|DEBUG|TRACE|loaded|LISTEN|LISTENING|UNCONN|tcp6?|udp6?|icmp6?|inet6?)\b/gi, color: colors.address },
  { pattern: /\b[\w@.:-]+\.(?:service|socket|timer|target|mount|automount|path|slice|scope|swap|device)\b/g, color: colors.path },
  { pattern: /(?:\bHTTP\/\d(?:\.\d)?["']?\s+|\b(?:status|status_code|http_code)\s*[=:]\s*["']?)([1-5]\d{2})\b/gi,
    capture: 1, color: (value) => Number(value) >= 400 ? colors.error : Number(value) >= 300 ? colors.warning : colors.success },
  { pattern: /\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|CONNECT)\s+(?=\/|https?:\/\/)/g, color: colors.address },
  { pattern: /\b(?:\d+(?:\.\d+)?)%\s+packet loss\b/gi,
    color: (value) => parseFloat(value) === 0 ? colors.success : colors.error },
  { pattern: /^(?:\/\S+|tmpfs|devtmpfs|overlay|shm)\s+(?:\S+\s+){3}(\d+(?:\.\d+)?%)(?=\s)/g,
    capture: 1, color: usageColor },
  { pattern: /\b(?:usage|used|utilization)\b[^%\r\n]{0,30}?(\d+(?:\.\d+)?%)/gi,
    capture: 1, color: usageColor },
  { pattern: /\b(?:\d+(?:\.\d+)?)%(?!\w)/g, color: colors.address },
  { pattern: /\b\d+(?:\.\d+)?\s*(?:[KMGTPE]i?B(?:\/s)?|[KMGTPE](?=\s|$)|bytes?|[kmun]?s|sec(?:onds?)?)(?![\w/])/g, color: colors.metadata },
  { pattern: /\b[\w.-]+\[\d+\]/g, color: colors.metadata },
  { pattern: /\b0x[\da-f]+\b/gi, color: colors.metadata },
  { pattern: /\b(?:pid|ppid|uid|gid|ttl|icmp_seq|port)\s*[=:]\s*(\d+)\b/gi, capture: 1, color: colors.metadata },
  { pattern: /\b[\w.-]+\s*[=:]\s*(true|false|null|yes|no)\b/gi, capture: 1,
    color: (value) => /^(true|yes)$/i.test(value) ? colors.success : colors.warning },
  { pattern: /^\S+\s+(\d+\/\d+)\s+(?:Running|Pending|Completed|Error|CrashLoopBackOff|ImagePullBackOff|ContainerCreating|Terminating)\b/g,
    capture: 1, color: (value) => {
      const [ready, total] = value.split("/").map(Number);
      return ready === total ? colors.success : ready === 0 ? colors.error : colors.warning;
    } }
];

function usageColor(value: string) {
  const percentage = parseFloat(value);
  return percentage >= 90 ? colors.error : percentage >= 80 ? colors.warning : colors.success;
}

export function highlightSpans(line: IBufferLine) {
  let text = "";
  const columns: number[] = [];
  const reusableCell = line.getCell(0);
  for (let x = 0; x < line.length; x++) {
    const cell = line.getCell(x, reusableCell)!;
    if (cell.getWidth() === 0) continue;
    const chars = cell.getChars() || " ";
    for (let i = 0; i < chars.length; i++) columns.push(x);
    text += chars;
  }
  columns.push(line.length);
  const spans: Array<{ x: number; width: number; color: string }> = [];
  const addSpan = (offset: number, length: number, color: string) => {
    const start = columns[offset];
    const end = columns[offset + length];
    if (spans.length >= 32 || end <= start || spans.some((span) => start < span.x + span.width && end > span.x)) return;
    for (let x = start; x < end; x++) {
      const cell = line.getCell(x, reusableCell)!;
      if (!cell.isFgDefault() || !cell.isBgDefault() || cell.isInverse() || cell.isInvisible()) return;
    }
    spans.push({ x: start, width: end - start, color });
  };
  // Anchor common PS1 forms at the start; leave any typed command untouched.
  const prompt = line.isWrapped ? null : (
    /^(\[)([\w.-]+)@([\w.-]+) (.+?)\][#$](?=\s|$)/.exec(text)
    ?? /^()([\w.-]+)@([\w.-]+):([~/][^\s]*|~)[#$](?=\s|$)/.exec(text)
  );
  if (prompt) {
    const [, prefix, user, host, directory] = prompt;
    const userOffset = prefix.length;
    const hostOffset = userOffset + user.length + 1;
    const directoryOffset = hostOffset + host.length + 1;
    addSpan(userOffset, user.length, user === "root" ? colors.error : colors.success);
    addSpan(hostOffset, host.length, colors.success);
    addSpan(directoryOffset, directory.length, colors.path);
    return spans;
  }
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      const value = rule.capture ? match[rule.capture] : match[0];
      if (rule.valid && !rule.valid(value)) continue;
      const offset = match.index + (rule.capture ? match[0].lastIndexOf(value) : 0);
      if (rule.parts) {
        for (const part of rule.parts(match)) addSpan(match.index + part.offset, part.length, part.color);
      } else {
        addSpan(offset, value.length, typeof rule.color === "function" ? rule.color(value) : rule.color);
      }
      if (spans.length >= 32) return spans;
    }
  }
  return spans;
}

type HighlightSpan = ReturnType<typeof highlightSpans>[number];
type HighlightedRow = { marker: IMarker; spans: HighlightSpan[]; decorations: IDisposable[] };

function disposeRow(row: HighlightedRow) {
  for (const decoration of row.decorations) decoration.dispose();
  row.marker.dispose();
}

function sameSpans(left: HighlightSpan[], right: HighlightSpan[]) {
  return left.length === right.length && left.every((span, index) => {
    const other = right[index];
    return span.x === other.x && span.width === other.width && span.color === other.color;
  });
}

export class OutputHighlighter {
  private enabled = false;
  private disposed = false;
  private pending = false;
  private rows: HighlightedRow[] = [];
  private cache = new Map<string, HighlightSpan[]>();
  private subscriptions: IDisposable[];
  private terminal: Terminal;
  private viewport?: HTMLElement;
  private lastViewportY = -1;
  private handleViewportScroll = () => this.schedule();

  constructor(terminal: Terminal) {
    this.terminal = terminal;
    this.subscriptions = [
      terminal.onWriteParsed(() => this.render()),
      // Parsing can emit one scroll event per line. Coalesce them before scanning.
      terminal.onScroll(() => this.schedule()),
      terminal.onResize(() => this.invalidate()),
      terminal.buffer.onBufferChange(() => this.invalidate()),
      terminal.onRender(() => {
        if (!this.enabled) return;
        this.attachViewport();
        if (terminal.buffer.active.viewportY !== this.lastViewportY) this.schedule();
      })
    ];
  }

  setEnabled(enabled: boolean) {
    if (this.disposed || this.enabled === enabled) return;
    this.enabled = enabled;
    this.attachViewport();
    this.invalidate();
  }

  private clear() {
    for (const row of this.rows) disposeRow(row);
    this.rows = [];
  }

  private invalidate() {
    this.pending = false;
    this.cache.clear();
    this.clear();
    this.render();
  }

  private schedule() {
    if (!this.enabled || this.disposed || this.pending) return;
    this.pending = true;
    // Microtasks run before paint: no 80ms delay and no first-frame white prompt.
    queueMicrotask(() => {
      if (this.pending) this.render();
    });
  }

  private attachViewport() {
    const viewport = this.enabled
      ? this.terminal.element?.querySelector<HTMLElement>(".xterm-viewport") ?? undefined
      : undefined;
    if (viewport === this.viewport) return;
    this.viewport?.removeEventListener("scroll", this.handleViewportScroll);
    this.viewport = viewport;
    // xterm 5.5 suppresses its public onScroll event for native wheel scrolling.
    viewport?.addEventListener("scroll", this.handleViewportScroll, { passive: true });
  }

  private spansForLine(line: IBufferLine) {
    const text = line.translateToString(false);
    const cell = line.getCell(0);
    let attributes = "";
    for (let x = 0; x < line.length; x++) {
      const current = line.getCell(x, cell)!;
      const eligible = current.isFgDefault() && current.isBgDefault() && !current.isInverse() && !current.isInvisible();
      attributes += String.fromCharCode(48 + current.getWidth() + (eligible ? 0 : 3));
    }
    // Include attributes and cell widths: identical text can change ANSI styling.
    const key = `${line.isWrapped}:${text.length}:${text}${attributes}`;
    let spans = this.cache.get(key);
    if (!spans) {
      spans = text.trim() ? highlightSpans(line) : [];
      if (this.cache.size >= 256) this.cache.delete(this.cache.keys().next().value!);
    } else {
      this.cache.delete(key);
    }
    this.cache.set(key, spans);
    return spans;
  }

  private render() {
    this.pending = false;
    if (!this.enabled || this.disposed) return;
    const buffer = this.terminal.buffer.active;
    this.lastViewportY = buffer.viewportY;
    if (buffer.type !== "normal") { this.clear(); return; }

    const previous = new Map<number, HighlightedRow>();
    for (const row of this.rows) {
      if (row.marker.isDisposed) disposeRow(row);
      else previous.set(row.marker.line, row);
    }
    const next: HighlightedRow[] = [];
    let remaining = 300;
    for (let y = buffer.viewportY + this.terminal.rows - 1; y >= buffer.viewportY && remaining > 0; y--) {
      const line = buffer.getLine(y);
      if (!line) continue;
      const spans = this.spansForLine(line).slice(0, remaining);
      if (!spans.length) continue;
      remaining -= spans.length;
      const existing = previous.get(y);
      previous.delete(y);
      if (existing && !existing.marker.isDisposed && sameSpans(existing.spans, spans)) {
        next.push(existing);
        continue;
      }
      if (existing) disposeRow(existing);
      // All matches on a row share one marker instead of one marker per token.
      const marker = this.terminal.registerMarker(y - buffer.baseY - buffer.cursorY);
      if (!marker) continue;
      const decorations: IDisposable[] = [];
      for (const { x, width, color } of spans) {
        const decoration = this.terminal.registerDecoration({ marker, x, width, foregroundColor: color, layer: "bottom" });
        if (decoration) decorations.push(decoration);
      }
      next.push({ marker, spans, decorations });
    }
    for (const row of previous.values()) disposeRow(row);
    this.rows = next;
  }

  dispose() {
    this.disposed = true;
    this.pending = false;
    this.viewport?.removeEventListener("scroll", this.handleViewportScroll);
    this.clear();
    this.cache.clear();
    for (const subscription of this.subscriptions) subscription.dispose();
  }
}
