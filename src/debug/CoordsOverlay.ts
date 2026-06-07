// Debug coordinates HUD (Minecraft-style F3 readout).
//
// Toggled with the F3 key. Shows the player's exact world position, the block
// they're standing in, and the chunk that block belongs to. Hidden by default.

import { CHUNK_SIZE } from "../world/constants";
import { worldToChunk, worldToLocal } from "../world/gen/coords";

export class CoordsOverlay {
  visible = false;

  private container: HTMLDivElement;

  constructor() {
    this.container = document.createElement("div");
    Object.assign(this.container.style, {
      position: "fixed",
      top: "12px",
      left: "12px",
      padding: "8px 10px",
      background: "rgba(0,0,0,0.6)",
      border: "1px solid rgba(255,255,255,0.2)",
      borderRadius: "6px",
      color: "white",
      font: "13px/1.5 monospace",
      whiteSpace: "pre",
      zIndex: "1000",
      pointerEvents: "none", // let clicks fall through to the game canvas
      display: "none",
    } as CSSStyleDeclaration);

    document.body.appendChild(this.container);
  }

  toggle() {
    this.visible = !this.visible;
    this.container.style.display = this.visible ? "block" : "none";
  }

  /** Refresh the readout for the player's current world position. */
  update(x: number, y: number, z: number) {
    if (!this.visible) return;

    const bx = Math.floor(x);
    const by = Math.floor(y);
    const bz = Math.floor(z);

    // Chunk the player's block lives in, plus the local position within it.
    const cx = worldToChunk(bx);
    const cy = worldToChunk(by);
    const cz = worldToChunk(bz);
    const lx = worldToLocal(bx);
    const ly = worldToLocal(by);
    const lz = worldToLocal(bz);

    this.container.textContent =
      `XYZ ${x.toFixed(2)} / ${y.toFixed(2)} / ${z.toFixed(2)}\n` +
      `Block ${bx} ${by} ${bz}\n` +
      `Chunk ${cx} ${cy} ${cz}  (local ${lx} ${ly} ${lz}, size ${CHUNK_SIZE})`;
  }
}
