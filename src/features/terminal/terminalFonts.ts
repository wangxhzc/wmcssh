import type { TerminalSettingsDto } from "../../types/settings";

const fontLoads = new Map<string, Promise<void>>();

/** Explicitly request faces before xterm measures its first character cell. */
export function loadTerminalFonts(settings: TerminalSettingsDto): Promise<void> {
  if (!document.fonts?.load) return Promise.resolve();
  const faces = [...new Set([400, settings.fontWeight, settings.fontWeightBold])]
    .map((weight) => `${weight} ${settings.fontSize}px ${settings.fontFamily}`);
  const key = JSON.stringify(faces);
  const existing = fontLoads.get(key);
  if (existing) return existing;

  // xterm measures a normal-weight W, even when a different display weight is
  // selected. Load that face as well as the normal and bold display faces.
  const pending = Promise.all(faces.map((face) => document.fonts.load(face, "W中文")))
    .then(() => undefined)
    .catch((error) => {
      fontLoads.delete(key);
      // Unavailable custom fonts must still allow a terminal using fallbacks.
      console.warn("[wmcssh][terminal] font loading failed; using fallback fonts", error);
    });
  fontLoads.set(key, pending);
  return pending;
}
