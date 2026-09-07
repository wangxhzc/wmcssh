export function terminalClipboardShortcut(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey" | "isComposing">,
  linux: boolean
): "copy" | "paste" | "pastePrimary" | undefined {
  if (event.isComposing || event.altKey || event.metaKey) return;
  const key = event.key.toLowerCase();
  if (event.ctrlKey && event.shiftKey && key === "c") return "copy";
  if (event.ctrlKey && event.shiftKey && key === "v") return "paste";
  if (event.ctrlKey && !event.shiftKey && key === "insert") return "copy";
  if (!event.ctrlKey && event.shiftKey && key === "insert") return linux ? "pastePrimary" : "paste";
}
