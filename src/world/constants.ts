export const CHUNK_SIZE = 16;
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE;

// Maximum height at which blocks can be placed (prevents infinite building and unnecessary chunk creation)
export const MAX_BUILD_HEIGHT = 128;

// Re-export block constants from centralized definitions
export {
  BLOCK_AIR,
  BLOCK_GRASS,
  BLOCK_DIRT,
  BLOCK_STONE,
  BLOCK_SAND,
  BLOCK_SNOW,
  BLOCK_COAL_ORE,
  BLOCK_IRON_ORE,
} from "./blocks/definitions";
