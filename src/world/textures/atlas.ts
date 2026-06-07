import * as THREE from "three";
import { ATLAS_SIZE } from "./config";

// Import textures using Vite's asset handling
import grassPath from "@/assets/blocks/textures/grass.png";
import grassSidePath from "@/assets/blocks/textures/grass_side.png";
import dirtPath from "@/assets/blocks/textures/dirt.png";
import stonePath from "@/assets/blocks/textures/stone.png";
import sandPath from "@/assets/blocks/textures/sand.png";
import snowPath from "@/assets/blocks/textures/snow.png";
import snowSidePath from "@/assets/blocks/textures/snow_side.png";
import coalOrePath from "@/assets/blocks/textures/coal_ore.png";
import ironOrePath from "@/assets/blocks/textures/iron_ore.png";
import treeSidePath from "@/assets/blocks/textures/tree_side.png";
import treeTopPath from "@/assets/blocks/textures/tree_top.png";
import leavesPath from "@/assets/blocks/textures/leaves.png";

// Texture paths in order
const TEXTURE_PATHS = [
  grassPath,       // 0 - grass top
  grassSidePath,   // 1 - grass side
  dirtPath,        // 2 - dirt
  stonePath,       // 3 - stone
  sandPath,        // 4 - sand
  snowPath,        // 5 - snow top
  snowSidePath,    // 6 - snow side
  coalOrePath,    // 7 - coal ore
  ironOrePath,     // 8 - iron ore
  treeSidePath,    // 9 - tree side
  treeTopPath,     // 10 - tree top
  leavesPath,      // 11 - leaves
] as const;

const TILE_SIZE = 16; // Each texture is 16x16 pixels

export class TextureAtlas {
  texture: THREE.Texture;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private loadedCount = 0;
  private totalTextures = TEXTURE_PATHS.length;
  private onReady: (() => void) | null = null;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = ATLAS_SIZE * TILE_SIZE;
    this.canvas.height = ATLAS_SIZE * TILE_SIZE;
    this.ctx = this.canvas.getContext("2d")!;

    // Leave the atlas transparent so textures with alpha (e.g. leaves) keep
    // their transparency; the chunk material uses alphaTest to cut those out.
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.colorSpace = THREE.SRGBColorSpace;

    this.loadAllTextures();
  }

  private loadAllTextures() {
    TEXTURE_PATHS.forEach((path, index) => {
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
        console.warn(`Failed to load texture: ${path}`);
        this.loadedCount++;
        if (this.loadedCount === this.totalTextures) {
          this.texture.needsUpdate = true;
          if (this.onReady) this.onReady();
        }
      };
      img.src = path;
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
