// Texture configuration - shared between main thread and workers
// No THREE.js dependencies here

export const ATLAS_SIZE = 4; // 4x4 grid = 16 slots

// Texture indices for each texture in the atlas
export const TEX = {
  GRASS_TOP: 0,
  GRASS_SIDE: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  SNOW_TOP: 5,
  SNOW_SIDE: 6,
  COAL_ORE: 7,
  IRON_ORE: 8,
  TREE_SIDE: 9,
  TREE_TOP: 10,
  LEAVES: 11,
} as const;

/**
 * Get UV coordinates for a texture index
 * Returns [u0, v0, u1, v1] for the tile
 */
export function getTextureUVs(textureIndex: number): [number, number, number, number] {
  const x = textureIndex % ATLAS_SIZE;
  const y = Math.floor(textureIndex / ATLAS_SIZE);
  
  const u0 = x / ATLAS_SIZE;
  const v0 = 1 - (y + 1) / ATLAS_SIZE; // Flip V coordinate
  const u1 = (x + 1) / ATLAS_SIZE;
  const v1 = 1 - y / ATLAS_SIZE;
  
  return [u0, v0, u1, v1];
}

