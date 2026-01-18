import * as THREE from "three";
import { ATLAS_SIZE } from "./textureConfig";

// Texture names that map to files in src/textures/
export const TEXTURE_NAMES = [
  "grass",       // 0 - grass top
  "grass_side",  // 1 - grass side
  "dirt",        // 2 - dirt
  "stone",       // 3 - stone
  "sand",        // 4 - sand
  "snow",        // 5 - snow top
  "snow_side",   // 6 - snow side
  "coal_ore",    // 7 - coal ore
  "iron_ore",    // 8 - iron ore
  "tree_side",   // 9 - tree side
  "tree_top",    // 10 - tree top
  "leaves",      // 11 - leaves
] as const;

export type TextureName = (typeof TEXTURE_NAMES)[number];

const TILE_SIZE = 16; // Each texture is 16x16 pixels

export class TextureAtlas {
  texture: THREE.Texture;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private loadedCount = 0;
  private totalTextures = TEXTURE_NAMES.length;
  private onReady: (() => void) | null = null;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = ATLAS_SIZE * TILE_SIZE;
    this.canvas.height = ATLAS_SIZE * TILE_SIZE;
    this.ctx = this.canvas.getContext("2d")!;
    
    // Fill with magenta for debugging missing textures
    this.ctx.fillStyle = "#ff00ff";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.colorSpace = THREE.SRGBColorSpace;

    this.loadAllTextures();
  }

  private loadAllTextures() {
    TEXTURE_NAMES.forEach((name, index) => {
      const img = new Image();
      img.onload = () => {
        const x = (index % ATLAS_SIZE) * TILE_SIZE;
        const y = Math.floor(index / ATLAS_SIZE) * TILE_SIZE;
        this.ctx.drawImage(img, x, y, TILE_SIZE, TILE_SIZE);
        this.loadedCount++;
        
        if (this.loadedCount === this.totalTextures) {
          this.texture.needsUpdate = true;
          if (this.onReady) this.onReady();
        }
      };
      img.onerror = () => {
        console.warn(`Failed to load texture: ${name}`);
        this.loadedCount++;
        if (this.loadedCount === this.totalTextures) {
          this.texture.needsUpdate = true;
          if (this.onReady) this.onReady();
        }
      };
      img.src = `/src/textures/${name}.png`;
    });
  }

  ready(callback: () => void) {
    if (this.loadedCount === this.totalTextures) {
      callback();
    } else {
      this.onReady = callback;
    }
  }
}
