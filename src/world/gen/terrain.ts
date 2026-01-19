import SimplexNoise from "simplex-noise";
import alea from "alea";
import {
  CHUNK_SIZE,
  BLOCK_AIR,
  BLOCK_GRASS,
  BLOCK_DIRT,
  BLOCK_STONE,
} from "../constants";

export function generateChunkTerrain(
  cx: number,
  cy: number,
  cz: number,
  seed: number,
): Uint16Array {
  const prng = alea(seed.toString());
  const noise = new SimplexNoise(prng);
  const blocks = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);

  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const worldX = cx * CHUNK_SIZE + lx;
      const worldZ = cz * CHUNK_SIZE + lz;

      // Regional variation - determines how mountainous an area is (low frequency)
      const regionNoise = noise.noise2D(worldX * 0.008, worldZ * 0.008);
      const mountainFactor = (regionNoise + 1) * 0.5; // 0 to 1
      
      // Base terrain noise
      const noiseValue = noise.noise2D(worldX * 0.03, worldZ * 0.03);
      
      // Amplitude varies by region: flat areas = 2, mountainous = 8
      const amplitude = 2 + mountainFactor * 6;
      const height = Math.floor(12 + noiseValue * amplitude);

      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        const worldY = cy * CHUNK_SIZE + ly;
        const index = ly * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx;

        if (worldY > height) {
          blocks[index] = BLOCK_AIR;
        } else if (worldY === height) {
          blocks[index] = BLOCK_GRASS;
        } else if (worldY >= height - 3) {
          blocks[index] = BLOCK_DIRT;
        } else {
          blocks[index] = BLOCK_STONE;
        }
      }
    }
  }

  return blocks;
}
