import type { IDisposable, Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";

/** Load after open(); unsupported GPUs keep xterm's default renderer. */
export function installTerminalRenderer(terminal: Terminal, onRendererChange: (accelerated: boolean) => void = () => {}): IDisposable {
  let addon: WebglAddon | undefined;
  let contextLoss: IDisposable | undefined;
  let accelerated = false;
  onRendererChange(false);
  const dispose = () => {
    contextLoss?.dispose();
    contextLoss = undefined;
    const current = addon;
    addon = undefined;
    current?.dispose();
    if (accelerated) {
      accelerated = false;
      onRendererChange(false);
    }
  };
  try {
    addon = new WebglAddon();
    contextLoss = addon.onContextLoss(dispose);
    terminal.loadAddon(addon);
    accelerated = true;
    onRendererChange(true);
  } catch (error) {
    dispose();
    console.warn("[wmcssh][terminal] WebGL unavailable; using DOM renderer", error);
  }
  return { dispose };
}
