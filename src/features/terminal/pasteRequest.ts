type PasteTarget = { sessionId?: string; terminal: { paste: (text: string) => void } };

export function createPasteRequest(text: string, target: PasteTarget, isCurrent: () => boolean) {
  const sessionId = target.sessionId;
  let sent = false;
  return {
    text,
    needsPreview: /[\r\n]/.test(text),
    send: () => {
      if (sent || !isCurrent() || target.sessionId !== sessionId) return;
      sent = true;
      target.terminal.paste(text);
    }
  };
}
