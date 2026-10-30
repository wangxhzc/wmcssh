const MAX_ENCODED_LENGTH = 1024 * 1024;

export function decodeRemoteClipboard(data: string): string | undefined {
  const separator = data.indexOf(";");
  if (separator < 0) return;
  const target = data.slice(0, separator);
  const encoded = data.slice(separator + 1);
  // Only accept clipboard writes. Queries must never expose local clipboard data.
  if (!/^[cs]*$/.test(target) || encoded === "?" || encoded.length > MAX_ENCODED_LENGTH) return;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return;
  try {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return;
  }
}
