// Centralized block definitions
// This file contains all block information in one place for easy management

import { TEX } from "../textures/config";

// Block texture configuration
export type TextureConfig = 
  | { type: "uniform"; texture: number } // Same texture on all faces
  | { type: "topSideBottom"; top: number; side: number; bottom: number }; // Different textures for top, sides, bottom

export interface BlockDef {
  id: number;
  name: string;
  solid: boolean;
  textureConfig: TextureConfig;
}

// Block definitions - single source of truth
// To add a new block, just add an entry here!
export const BLOCK_DEFINITIONS: BlockDef[] = [
  {
    id: 0,
    name: "Air",
    solid: false,
    textureConfig: { type: "uniform", texture: TEX.GRASS_TOP }, // Placeholder, won't render
  },
  {
    id: 1,
    name: "Grass",
    solid: true,
    textureConfig: { type: "topSideBottom", top: TEX.GRASS_TOP, side: TEX.GRASS_SIDE, bottom: TEX.DIRT },
  },
  {
    id: 2,
    name: "Dirt",
    solid: true,
    textureConfig: { type: "uniform", texture: TEX.DIRT },
  },
  {
    id: 3,
    name: "Stone",
    solid: true,
    textureConfig: { type: "uniform", texture: TEX.STONE },
  },
  {
    id: 4,
    name: "Sand",
    solid: true,
    textureConfig: { type: "uniform", texture: TEX.SAND },
  },
  {
    id: 5,
    name: "Snow",
    solid: true,
    textureConfig: { type: "topSideBottom", top: TEX.SNOW_TOP, side: TEX.SNOW_SIDE, bottom: TEX.DIRT },
  },
  {
    id: 6,
    name: "Coal Ore",
    solid: true,
    textureConfig: { type: "uniform", texture: TEX.COAL_ORE },
  },
  {
    id: 7,
    name: "Iron Ore",
    solid: true,
    textureConfig: { type: "uniform", texture: TEX.IRON_ORE },
  },
];

// Export block constants for convenience
export const BLOCK_AIR = 0;
export const BLOCK_GRASS = 1;
export const BLOCK_DIRT = 2;
export const BLOCK_STONE = 3;
export const BLOCK_SAND = 4;
export const BLOCK_SNOW = 5;
export const BLOCK_COAL_ORE = 6;
export const BLOCK_IRON_ORE = 7;