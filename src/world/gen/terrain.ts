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
  
  // First pass: identify stone-heavy columns and their properties
  // Store both original stone-heavy columns and spread stone columns separately
  const stoneHeavyData: Map<string, { percentage: number; height: number; isOriginal: boolean }> = new Map();
  const spreadStoneData: Map<string, { percentage: number }> = new Map();
  
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

      // Check if this is high terrain
      const isHighTerrain = height > 15;
      
      // 1 in 20 chance that high terrain is 80-95% stone (stone-heavy mountains)
      const columnSeed = worldX * 7919 + worldZ * 9973;
      const columnRng = alea(seed.toString() + columnSeed.toString());
      const isStoneHeavyMountain = isHighTerrain && Math.floor(columnRng() * 20) === 0;
      
      // Store stone-heavy column data (mark as original)
      if (isStoneHeavyMountain) {
        const stonePercentage = 0.80 + columnRng() * 0.15; // Random between 0.80 and 0.95
        stoneHeavyData.set(`${lx},${lz}`, { percentage: stonePercentage, height, isOriginal: true });
      }
    }
  }

  // Second pass: generate blocks with horizontal stone spreading
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

      // Use noise to create larger stone patches (lower frequency = larger patches)
      const stonePatchNoise = noise.noise2D(worldX * 0.04, worldZ * 0.04);
      const stonePatchValue = (stonePatchNoise + 1) * 0.5; // 0 to 1
      
      // Check if this column is original stone-heavy
      const currentKey = `${lx},${lz}`;
      const stoneHeavyInfo = stoneHeavyData.get(currentKey);
      const isStoneHeavyMountain = !!stoneHeavyInfo && stoneHeavyInfo.isOriginal;
      let stonePercentage = stoneHeavyInfo?.percentage || 0;
      
      // Check if this column already has spread stone (cannot spread further)
      const spreadInfo = spreadStoneData.get(currentKey);
      if (spreadInfo) {
        stonePercentage = spreadInfo.percentage;
      }
      
      // Check if neighboring columns are ORIGINAL stone-heavy (for horizontal spreading)
      // Only original stone-heavy columns can spread - spread stone cannot spread further
      const neighbors: Array<[number, number]> = [
        [lx - 1, lz], [lx + 1, lz], // East/West
        [lx, lz - 1], [lx, lz + 1], // North/South
      ];
      
      let hasOriginalStoneHeavyNeighbor = false;
      let neighborStonePercentage = 0;
      
      for (const [nx, nz] of neighbors) {
        if (nx >= 0 && nx < CHUNK_SIZE && nz >= 0 && nz < CHUNK_SIZE) {
          const neighborKey = `${nx},${nz}`;
          const neighborInfo = stoneHeavyData.get(neighborKey);
          // Only spread from original stone-heavy columns, not from already-spread stone
          if (neighborInfo && neighborInfo.isOriginal) {
            hasOriginalStoneHeavyNeighbor = true;
            neighborStonePercentage = neighborInfo.percentage;
            break; // Use first found neighbor
          }
        }
      }
      
      // If this column has an ORIGINAL stone-heavy neighbor, allow stone to spread
      // Only spread once - spread stone cannot spread further (keeps clusters tight)
      if (hasOriginalStoneHeavyNeighbor && !isStoneHeavyMountain && !spreadInfo && height > 15) {
        const spreadSeed = worldX * 7919 + worldZ * 9973;
        const spreadRng = alea(seed.toString() + spreadSeed.toString());
        const spreadChance = spreadRng();
        
        // Reduced chance (10% instead of 15%) to keep spread very close to cluster
        if (spreadChance < 0.10) {
          // Use 40-60% of the neighbor's stone percentage for spreading
          const spreadPercentage = neighborStonePercentage * (0.40 + spreadRng() * 0.20);
          stonePercentage = spreadPercentage;
          // Mark this as spread stone (cannot spread further)
          spreadStoneData.set(currentKey, { percentage: spreadPercentage });
        }
      }
      
      // Much rarer stone patches - only in very specific noise areas
      const isHighTerrain = height > 15;
      const isRareStonePatch = stonePatchValue > 0.96 && isHighTerrain;
      
      // Low areas or steep slopes: even rarer, noise > 0.98
      const isLowArea = height < 10;
      const isSteepSlope = mountainFactor > 0.7;
      const isRareLowStonePatch = stonePatchValue > 0.98 && (isLowArea || isSteepSlope);
      
      // Determine if this column should have stone exposed
      const shouldExposeStone = isRareStonePatch || isRareLowStonePatch;
      
      // Check if this column has stone (either stone-heavy or spread from neighbor)
      const hasStoneContent = stonePercentage > 0;

      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        const worldY = cy * CHUNK_SIZE + ly;
        const index = ly * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx;

        if (worldY > height) {
          blocks[index] = BLOCK_AIR;
        } else {
          // For stone-heavy mountains or spread stone, determine if this block should be stone
          let shouldBeStone = false;
          
          if (hasStoneContent) {
            // Use a random value per block position to determine if it should be stone
            const blockSeed = worldX * 7919 + worldZ * 9973 + worldY * 3571;
            const blockRng = alea(seed.toString() + blockSeed.toString());
            const randomValue = blockRng();
            
            // Stone percentage applies to the entire column
            shouldBeStone = randomValue < stonePercentage;
          }
          
          if (worldY === height) {
            // Surface layer
            if (hasStoneContent && shouldBeStone) {
              blocks[index] = BLOCK_STONE;
            } else if (shouldExposeStone) {
              blocks[index] = BLOCK_STONE;
            } else {
              blocks[index] = BLOCK_GRASS;
            }
          } else if (worldY >= height - 3) {
            // Top 3 layers below surface (dirt layer)
            if (hasStoneContent && shouldBeStone) {
              blocks[index] = BLOCK_STONE;
            } else if (shouldExposeStone) {
              blocks[index] = BLOCK_STONE;
            } else {
              blocks[index] = BLOCK_DIRT;
            }
          } else {
            // Deep underground
            if (hasStoneContent && shouldBeStone) {
              blocks[index] = BLOCK_STONE;
            } else {
              blocks[index] = BLOCK_STONE; // Always stone deep underground
            }
          }
        }
      }
    }
  }

  return blocks;
}
