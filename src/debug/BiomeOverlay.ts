// Debug visualizer for biome parameter maps.
//
// Toggled with the 'B' key. Draws a top-down map of the area around the player
// where each pixel's colour encodes the biome parameters at that world column
// (R = temperature, G = continentalness, B = humidity). Smooth colour gradients
// confirm the parameter fields are continuous. A caption shows the numeric
// values at the player's position.

import type { NoiseSampler } from "../world/gen/noise";
import { sampleBiomeParams } from "../world/biome/params";
import { selectBiome } from "../world/biome/biomeTable";

export class BiomeOverlay {
  visible = false;

  private container: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private caption: HTMLDivElement;

  private readonly size = 128; // canvas pixels per side
  private readonly blocksPerPixel = 4; // -> covers size*bpp = 512 blocks

  // Last drawn center, so the map only re-renders when the player moves enough.
  private lastCenterX = Infinity;
  private lastCenterZ = Infinity;

  constructor() {
    this.container = document.createElement("div");
    Object.assign(this.container.style, {
      position: "fixed",
      top: "12px",
      right: "12px",
      padding: "8px",
      background: "rgba(0,0,0,0.6)",
      border: "1px solid rgba(255,255,255,0.2)",
      borderRadius: "6px",
      color: "white",
      font: "12px Arial, sans-serif",
      zIndex: "1000",
      pointerEvents: "none", // let clicks fall through to the game canvas
      display: "none",
    } as CSSStyleDeclaration);

    this.canvas = document.createElement("canvas");
    this.canvas.width = this.size;
    this.canvas.height = this.size;
    this.canvas.style.imageRendering = "pixelated";
    this.canvas.style.width = `${this.size * 1.5}px`;
    this.canvas.style.height = `${this.size * 1.5}px`;
    this.canvas.style.display = "block";

    this.caption = document.createElement("div");
    this.caption.style.marginTop = "6px";
    this.caption.style.whiteSpace = "pre";

    this.container.appendChild(this.canvas);
    this.container.appendChild(this.caption);
    document.body.appendChild(this.container);

    this.ctx = this.canvas.getContext("2d")!;
  }

  toggle() {
    this.visible = !this.visible;
    this.container.style.display = this.visible ? "block" : "none";
    // Force a redraw next update.
    this.lastCenterX = Infinity;
    this.lastCenterZ = Infinity;
  }

  /** Re-render the map (throttled) and the caption for the player's position. */
  update(noise: NoiseSampler, centerX: number, centerZ: number) {
    if (!this.visible) return;

    const cx = Math.floor(centerX);
    const cz = Math.floor(centerZ);

    if (
      Math.abs(cx - this.lastCenterX) >= this.blocksPerPixel ||
      Math.abs(cz - this.lastCenterZ) >= this.blocksPerPixel
    ) {
      this.lastCenterX = cx;
      this.lastCenterZ = cz;
      this.drawMap(noise, cx, cz);
    }

    this.drawCaption(noise, cx, cz);
  }

  private drawMap(noise: NoiseSampler, centerX: number, centerZ: number) {
    const img = this.ctx.createImageData(this.size, this.size);
    const half = (this.size * this.blocksPerPixel) / 2;

    for (let py = 0; py < this.size; py++) {
      for (let px = 0; px < this.size; px++) {
        const wx = centerX - half + px * this.blocksPerPixel;
        const wz = centerZ - half + py * this.blocksPerPixel;
        const biome = selectBiome(sampleBiomeParams(noise, wx, wz));
        const i = (py * this.size + px) * 4;
        img.data[i] = biome.debugColor[0]; // R
        img.data[i + 1] = biome.debugColor[1]; // G
        img.data[i + 2] = biome.debugColor[2]; // B
        img.data[i + 3] = 255;
      }
    }

    this.ctx.putImageData(img, 0, 0);

    // Center marker for the player position.
    const c = this.size / 2;
    this.ctx.fillStyle = "white";
    this.ctx.fillRect(c - 1, c - 1, 3, 3);
  }

  private drawCaption(noise: NoiseSampler, centerX: number, centerZ: number) {
    const p = sampleBiomeParams(noise, centerX, centerZ);
    const biome = selectBiome(p);
    this.caption.textContent =
      `${biome.name}\n` +
      `T ${p.temperature.toFixed(2)}  H ${p.humidity.toFixed(2)}  ` +
      `C ${p.continentalness.toFixed(2)}`;
  }
}
