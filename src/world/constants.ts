export const CHUNK_SIZE = 16;
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE;

// Maximum height at which blocks can be placed (prevents infinite building and unnecessary chunk creation)
export const MAX_BUILD_HEIGHT = 128;

export const BLOCK_AIR = 0;
export const BLOCK_GRASS = 1;
export const BLOCK_DIRT = 2;
export const BLOCK_STONE = 3;
