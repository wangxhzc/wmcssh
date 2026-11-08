import assert from "node:assert/strict";
import test from "node:test";
import xterm from "@xterm/xterm";
import { highlightSpans, highlightColors as colors, OutputHighlighter } from "../src/features/terminal/outputHighlight.ts";

async function terminalWith(t, text) {
  const terminal = new xterm.Terminal({ cols: 120, rows: 10, allowProposedApi: true });
  t.after(() => terminal.dispose());
  await new Promise((resolve) => terminal.write(text, resolve));
  return terminal;
}

test("maps UTF-16 matches to terminal cells and validates IPv4", async (t) => {
  const terminal = await terminalWith(t, "中文😀 ERROR 192.168.1.1 999.1.1.1 WARNING OK 2026-11-03T12:30:00Z");
  const spans = highlightSpans(terminal.buffer.active.getLine(0));
  assert.equal(spans.length, 5);
  assert.ok(spans.some((span) => span.x === 6 && span.width === 5 && span.color === colors.error));
});

test("preserves ANSI foreground, background, inverse and invisible text", async (t) => {
  const terminal = await terminalWith(t, "\x1b[31mERROR\x1b[0m \x1b[44mWARNING\x1b[0m \x1b[7mFAILED\x1b[0m \x1b[8mOK\x1b[0m ERROR");
  const spans = highlightSpans(terminal.buffer.active.getLine(0));
  assert.equal(spans.length, 1);
  assert.equal(spans[0].x, 24);
});

test("colors common prompts without coloring typed commands", async (t) => {
  for (const text of ["[root@jenkins-22 ~]# ", "root@kcsprootca:~# ", "wangxh@wangxh-ai:~$ echo ERROR 10.0.0.1", "[root@node-6 /var/log]# "]) {
    const terminal = await terminalWith(t, text);
    const line = terminal.buffer.active.getLine(0);
    const spans = highlightSpans(line);
    assert.equal(spans.length, 3, text);
    assert.equal(spans[0].color, text.includes("root@") ? "#E8A0A0" : "#A4D4B8");
    assert.equal(line.translateToString(false, spans[1].x, spans[1].x + spans[1].width), /@([^ :]+)/.exec(text)[1]);
    assert.equal(spans[2].color, "#A0C4F0");
  }
});

test("preserves existing prompt colors and ignores embedded or wrapped prompts", async (t) => {
  const colored = await terminalWith(t, "\x1b[32mroot@host\x1b[0m:\x1b[34m~\x1b[0m# ");
  assert.deepEqual(highlightSpans(colored.buffer.active.getLine(0)), []);
  const embedded = await terminalWith(t, "log: [root@host ~]# ");
  assert.deepEqual(highlightSpans(embedded.buffer.active.getLine(0)), []);
  const wrapped = await terminalWith(t, "x".repeat(120) + "root@host:~# ");
  assert.deepEqual(highlightSpans(wrapped.buffer.active.getLine(1)), []);
});

test("defaults off, clears decorations when disabled and skips alternate screen", async (t) => {
  const terminal = await terminalWith(t, "ERROR");
  let created = 0;
  let disposed = 0;
  terminal.registerDecoration = () => { created++; return { dispose() { disposed++; } }; };
  const highlighter = new OutputHighlighter(terminal);
  highlighter.setAcceleratedRendering(true);
  t.after(() => highlighter.dispose());
  const settle = () => new Promise((resolve) => setTimeout(resolve, 110));
  await settle();
  assert.equal(created, 0);
  highlighter.setEnabled(true);
  assert.equal(created, 1);
  await settle();
  assert.equal(created, 1);
  highlighter.setEnabled(false);
  assert.equal(disposed, 1);
  await new Promise((resolve) => terminal.write("\x1b[?1049hERROR", resolve));
  highlighter.setEnabled(true);
  await settle();
  assert.equal(created, 1);
});

async function coloredTokens(t, text) {
  const terminal = await terminalWith(t, text);
  const line = terminal.buffer.active.getLine(0);
  return highlightSpans(line).map(({ x, width, color }) => ({
    text: line.translateToString(false, x, x + width), color
  }));
}

test("recognizes common Linux output structures with nonoverlapping spans", async (t) => {
  const samples = [
    ["Last login: Tue Nov  3 18:18:03 2026 from 10.0.211.62", "Tue Nov  3 18:18:03 2026", colors.metadata],
    ["Nov  3 18:18:03 host sshd[1234]: permission denied", "permission denied", colors.error],
    ["inet 192.168.1.2/24 brd 192.168.1.255", "192.168.1.2/24", colors.address],
    ["inet6 fe80::1234%eth0/64 scope link", "fe80::1234%eth0/64", colors.address],
    ["inet6 2001:db8::12:34:56/64 scope global", "2001:db8::12:34:56/64", colors.address],
    ["LISTEN 0 128 [::]:22 [::]:*", "::", colors.address],
    ["link/ether aa:bb:cc:dd:ee:ff", "aa:bb:cc:dd:ee:ff", colors.metadata],
    ["nginx.service loaded active running", "nginx.service", colors.path],
    ["pod-a 0/1 CrashLoopBackOff 4 10m", "CrashLoopBackOff", colors.error],
    ["pod-a 0/1 CrashLoopBackOff 4 10m", "0/1", colors.error],
    ["tcp ESTAB 0 0 10.0.0.1:22", "ESTAB", colors.success],
    ["-rwxr-xr-x 1 root root 1.2MiB Nov 3 18:00 app", "-rwxr-xr-x", colors.address],
    ["read /var/log/syslog and https://host/ERROR/10.0.0.1", "/ERROR/10.0.0.1", colors.path],
    ["HTTP/1.1 503 Service Unavailable", "503", colors.error],
    ['10.0.0.1 - "GET /health HTTP/1.1" 200 123', "200", colors.success],
    ["status_code=302 redirect", "302", colors.warning],
    ["/dev/sda1 100G 95G 5G 95% /", "95%", colors.error],
    ["Memory used: 83.7%", "83.7%", colors.warning],
    ["Swap used: 0.0%", "0.0%", colors.success],
    ["0% packet loss", "0% packet loss", colors.success],
    ["100% packet loss", "100% packet loss", colors.error],
    ["64 bytes ttl=64 time=1.25 ms", "1.25 ms", colors.metadata],
    ["UUID=12345678-1234-1234-1234-123456789abc", "12345678-1234-1234-1234-123456789abc", colors.metadata],
    ["enabled=true pid=1234", "true", colors.success]
  ];
  for (const [text, token, color] of samples) {
    assert.ok((await coloredTokens(t, text)).some((span) => span.text === token && span.color === color), text);
  }
});

test("avoids false IPs, arbitrary HTTP numbers, substring statuses and overlapping tokens", async (t) => {
  assert.deepEqual(await coloredTokens(t, "999.1.1.1 10.0.0.1/33 2001:db8::1/129 1::2::3 123:45:6 200 404 500"), []);
  assert.deepEqual(await coloredTokens(t, "proactive inactiveCount myERRORfile"), []);
  const tokens = await coloredTokens(t, "https://host/ERROR/10.0.0.1 fe80::1/64");
  assert.equal(tokens.length, 4);
});

test("recognizes protocol URLs and colors raw host, port and path components", async (t) => {
  for (const scheme of ["http", "https", "ftp", "ftps", "socks4", "socks4a", "socks5", "socks5h", "ssh", "sftp", "ws", "wss", "git+ssh", "redis", "postgresql"]) {
    assert.deepEqual(await coloredTokens(t, `${scheme}://127.0.0.1:7897/ERROR?q=1`), [
      { text: `${scheme}://`, color: colors.metadata },
      { text: "127.0.0.1", color: colors.address },
      { text: "7897", color: colors.metadata },
      { text: "/ERROR?q=1", color: colors.path }
    ], scheme);
  }
  assert.deepEqual(await coloredTokens(t, "socks5h://127.0.0.1:7897"), [
    { text: "socks5h://", color: colors.metadata },
    { text: "127.0.0.1", color: colors.address },
    { text: "7897", color: colors.metadata }
  ]);
  assert.deepEqual(await coloredTokens(t, "https://example.com:443/api#OK"), [
    { text: "https://", color: colors.metadata },
    { text: "example.com", color: colors.address },
    { text: "443", color: colors.metadata },
    { text: "/api#OK", color: colors.path }
  ]);
  assert.deepEqual(await coloredTokens(t, "ftp://[::1]:21/pub"), [
    { text: "ftp://", color: colors.metadata },
    { text: "[::1]", color: colors.address },
    { text: "21", color: colors.metadata },
    { text: "/pub", color: colors.path }
  ]);
  assert.deepEqual(await coloredTokens(t, "file:///var/log/app.log"), [
    { text: "file://", color: colors.metadata },
    { text: "/var/log/app.log", color: colors.path }
  ]);
});

test("colors IPv4 and bracketed IPv6 endpoint components without matching keywords inside paths", async (t) => {
  for (const host of ["10.0.0.1", "[2001:db8::1]", "[fe80::1%eth0]", "localhost", "jenkins.example.com"]) {
    const address = host.replace(/^\[|\]$/g, "");
    assert.deepEqual(await coloredTokens(t, `${host}:8080`), [
      { text: address, color: colors.address },
      { text: "8080", color: colors.metadata }
    ]);
    assert.deepEqual(await coloredTokens(t, `${host}:8080/ERROR/10.1.1.1?q=1`), [
      { text: address, color: colors.address },
      { text: "8080", color: colors.metadata },
      { text: "/ERROR/10.1.1.1?q=1", color: colors.path }
    ]);
  }
  assert.ok(!(await coloredTokens(t, "10.0.0.1:65536/path")).some((span) => span.text === "65536"));
  assert.deepEqual(await coloredTokens(t, "10.0.0.1/health"), [
    { text: "10.0.0.1", color: colors.address },
    { text: "/health", color: colors.path }
  ]);
});

test("new prompts are decorated during parsed-output notification without a timer", async (t) => {
  const terminal = await terminalWith(t, "[root@host ~]# ");
  let created = 0;
  terminal.registerDecoration = () => { created++; return { dispose() {} }; };
  const highlighter = new OutputHighlighter(terminal);
  highlighter.setAcceleratedRendering(true);
  t.after(() => highlighter.dispose());
  highlighter.setEnabled(true);
  assert.equal(created, 3);
  const parsed = new Promise((resolve) => terminal.onWriteParsed(() => {
    assert.equal(created, 6);
    resolve();
  }));
  terminal.write("\r\n[root@host ~]# ");
  await parsed;
});

test("decoration cap prioritizes the latest prompt in dense output", async (t) => {
  const terminal = new xterm.Terminal({ cols: 240, rows: 24, allowProposedApi: true });
  t.after(() => terminal.dispose());
  await new Promise((resolve) => terminal.write(("ERROR ".repeat(39) + "\r\n").repeat(12) + "[root@host ~]# ", resolve));
  const decorations = [];
  terminal.registerDecoration = (options) => { decorations.push(options); return { dispose() {} }; };
  const highlighter = new OutputHighlighter(terminal);
  highlighter.setAcceleratedRendering(true);
  t.after(() => highlighter.dispose());
  highlighter.setEnabled(true);
  assert.equal(decorations.length, 300);
  assert.equal(decorations[0].marker.line, 12);
  assert.equal(decorations[0].foregroundColor, colors.error);
});

test("native viewport scroll refreshes history when xterm suppresses onScroll", async (t) => {
  const terminal = await terminalWith(t, Array.from({ length: 40 }, (_, i) => `ERROR row-${i}`).join("\r\n"));
  class Viewport extends EventTarget {
    listeners = 0;
    addEventListener(...args) { super.addEventListener(...args); this.listeners++; }
    removeEventListener(...args) { super.removeEventListener(...args); this.listeners--; }
  }
  const viewport = new Viewport();
  const element = new EventTarget();
  element.querySelector = () => viewport;
  Object.defineProperty(terminal, "element", { value: element });
  const decorations = [];
  terminal.registerDecoration = (options) => { decorations.push(options); return { dispose() {} }; };
  const highlighter = new OutputHighlighter(terminal);
  highlighter.setAcceleratedRendering(true);
  t.after(() => highlighter.dispose());
  highlighter.setEnabled(true);
  assert.equal(viewport.listeners, 1);
  decorations.length = 0;
  let apiScrollEvents = 0;
  terminal.onScroll(() => apiScrollEvents++);
  // Reproduce xterm 5.5 Viewport's suppressScrollEvent=true path.
  terminal._core._bufferService.scrollLines(-20, true);
  assert.equal(apiScrollEvents, 0);
  assert.equal(terminal.buffer.active.viewportY, 10);
  viewport.dispatchEvent(new Event("scroll"));
  await Promise.resolve();
  assert.ok(decorations.some(({ marker }) => marker.line === 10));
  highlighter.setEnabled(false);
  assert.equal(viewport.listeners, 0);
});

test("coalesces per-line scroll notifications and shares one marker per highlighted row", async (t) => {
  const terminal = await terminalWith(t, "");
  let created = 0;
  let markers = 0;
  const registerMarker = terminal.registerMarker.bind(terminal);
  terminal.registerMarker = (...args) => { markers++; return registerMarker(...args); };
  terminal.registerDecoration = () => { created++; return { dispose() {} }; };
  const highlighter = new OutputHighlighter(terminal);
  highlighter.setAcceleratedRendering(true);
  t.after(() => highlighter.dispose());
  highlighter.setEnabled(true);
  let updates = 0;
  const render = highlighter.render.bind(highlighter);
  highlighter.render = () => { updates++; render(); };
  await new Promise((resolve) => terminal.write("ERROR 10.0.0.1 /var/log/app.log\r\n".repeat(1000), resolve));
  await Promise.resolve();
  assert.ok(updates <= 2, `updates=${updates}`);
  assert.ok(created <= 30, `decorations=${created}`);
  assert.ok(markers <= 10, `markers=${markers}`);
});

test("reuses unchanged visible rows during scrolling and invalidates cached ANSI attributes", async (t) => {
  const terminal = await terminalWith(t, "ERROR 10.0.0.1\r\n".repeat(40));
  let created = 0;
  let removed = 0;
  terminal.registerDecoration = () => { created++; return { dispose() { removed++; } }; };
  const highlighter = new OutputHighlighter(terminal);
  highlighter.setAcceleratedRendering(true);
  t.after(() => highlighter.dispose());
  highlighter.setEnabled(true);
  const initial = created;
  terminal._core._bufferService.scrollLines(-1, false);
  await Promise.resolve();
  assert.equal(created - initial, 2);
  assert.equal(removed, 0);
  terminal._core._bufferService.scrollLines(1, false);
  await Promise.resolve();
  assert.equal(removed, 2);
  await new Promise((resolve) => terminal.write("ERROR", resolve));
  await Promise.resolve();
  const beforeStyleChange = created;
  await new Promise((resolve) => terminal.write("\r\x1b[31mERROR\x1b[0m", resolve));
  await Promise.resolve();
  assert.equal(created, beforeStyleChange);
  assert.ok(removed >= 3);
  assert.ok(highlighter.cache.size <= 256);
});

function selectionSurface(terminal) {
  const element = new EventTarget();
  element.querySelector = () => null;
  Object.defineProperty(terminal, "element", { value: element });
  const event = new Event("mousedown");
  Object.assign(event, { button: 0, shiftKey: false });
  return { element, event };
}

test("WebGL keeps new history rows colored while the mouse is held down", async (t) => {
  const terminal = await terminalWith(t, "ERROR 10.0.240.233 /var/log/app.log\r\n".repeat(100));
  const { element, event } = selectionSurface(terminal);
  terminal.registerDecoration = () => ({ dispose() {} });
  const highlighter = new OutputHighlighter(terminal);
  t.after(() => highlighter.dispose());
  highlighter.setEnabled(true);
  highlighter.setAcceleratedRendering(true);
  const initialRows = [...highlighter.rows];
  element.dispatchEvent(event);
  assert.ok(highlighter.rows.every((row, index) => row === initialRows[index]));
  terminal._core._bufferService.scrollLines(-20, false);
  await Promise.resolve();
  assert.ok(highlighter.rows.some(row => row.marker.line === terminal.buffer.active.viewportY));
});

test("unsupported WebGL blocks highlighting and context loss removes existing decorations", async (t) => {
  const terminal = await terminalWith(t, "ERROR 10.0.240.233 /var/log/app.log\r\n".repeat(100));
  let decorations = 0;
  terminal.registerDecoration = () => {
    decorations++;
    return { dispose() { decorations--; } };
  };
  const highlighter = new OutputHighlighter(terminal);
  t.after(() => highlighter.dispose());
  highlighter.setEnabled(true);
  assert.equal(decorations, 0);
  await new Promise(resolve => terminal.write("ERROR no GPU\r\n", resolve));
  assert.equal(decorations, 0);
  highlighter.setAcceleratedRendering(true);
  assert.ok(decorations > 0);
  highlighter.setAcceleratedRendering(false);
  assert.equal(decorations, 0);
  assert.equal(terminal.markers.length, 0);
  highlighter.setEnabled(true);
  terminal._core._bufferService.scrollLines(-20, false);
  await Promise.resolve();
  assert.equal(decorations, 0);
  highlighter.setAcceleratedRendering(true);
  assert.ok(decorations > 0);
  highlighter.setEnabled(false);
  highlighter.setAcceleratedRendering(false);
  highlighter.setAcceleratedRendering(true);
  assert.equal(decorations, 0);
});
