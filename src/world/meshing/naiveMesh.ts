import { Chunk } from "../Chunk";
import { BlockRegistry } from "../BlockRegistry";
import { CHUNK_SIZE, BLOCK_AIR, BLOCK_WATER } from "../constants";
import { getTextureUVs } from "../textures/config";
import { localIndex } from "../gen/coords";
import { levelToHeight } from "../sim/fluid";

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

const CUBE_FACES = [
  // +X face (right) - looking from +X toward origin
  {
    normal: [1, 0, 0],
    vertices: [
      [1, 0, 1],
      [1, 1, 1],
      [1, 1, 0],
      [1, 0, 0],
    ],
    uvs: [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ],
  },
  // -X face (left) - looking from -X toward origin
  {
    normal: [-1, 0, 0],
    vertices: [
      [0, 0, 0],
      [0, 1, 0],
      [0, 1, 1],
      [0, 0, 1],
    ],
    uvs: [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ],
  },
  // +Y face (top) - looking from +Y toward origin
  {
    normal: [0, 1, 0],
    vertices: [
      [0, 1, 0],
      [1, 1, 0],
      [1, 1, 1],
      [0, 1, 1],
    ],
    uvs: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  },
  // -Y face (bottom) - looking from -Y toward origin
  {
    normal: [0, -1, 0],
    vertices: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 0, 0],
      [0, 0, 0],
    ],
    uvs: [
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
  },
  // +Z face (front) - looking from +Z toward origin
  {
    normal: [0, 0, 1],
    vertices: [
      [0, 0, 1],
      [0, 1, 1],
      [1, 1, 1],
      [1, 0, 1],
    ],
    uvs: [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ],
  },
  // -Z face (back) - looking from -Z toward origin
  {
    normal: [0, 0, -1],
    vertices: [
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 0],
    ],
    uvs: [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ],
  },
];

export function naiveMesh(
  chunk: Chunk,
  registry: BlockRegistry,
  // Out-of-bounds neighbour lookup (one of nx/ny/nz is -1 or CHUNK_SIZE). Returns
  // the adjacent chunk's block, or null when that neighbour is unknown. Omitted
  // → every chunk-boundary face is rendered (the original behaviour).
  neighborAt?: (nx: number, ny: number, nz: number) => number | null,
): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  let vertexCount = 0;

  for (let y = 0; y < CHUNK_SIZE; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const blockId = chunk.getBlock(x, y, z);
        if (!registry.isSolid(blockId)) continue;

        // Check each face - only create face if neighbor is within chunk and is air
        const neighbors = [
          { nx: x + 1, ny: y, nz: z }, // +X
          { nx: x - 1, ny: y, nz: z }, // -X
          { nx: x, ny: y + 1, nz: z }, // +Y
          { nx: x, ny: y - 1, nz: z }, // -Y
          { nx: x, ny: y, nz: z + 1 }, // +Z
          { nx: x, ny: y, nz: z - 1 }, // -Z
        ];

        CUBE_FACES.forEach((face, faceIdx) => {
          const { nx, ny, nz } = neighbors[faceIdx];

          // Check if neighbor is within chunk bounds
          const inBounds =
            nx >= 0 &&
            nx < CHUNK_SIZE &&
            ny >= 0 &&
            ny < CHUNK_SIZE &&
            nz >= 0 &&
            nz < CHUNK_SIZE;

          // The neighbour across this face: read in-chunk directly, otherwise
          // ask the cross-chunk lookup (null = unknown neighbour).
          const neighborId = inBounds
            ? chunk.getBlock(nx, ny, nz)
            : neighborAt
              ? neighborAt(nx, ny, nz)
              : null;

          // Render the face unless a known, opaque neighbour fully occludes it.
          // A non-opaque neighbour (air, or a cutout block like leaves) doesn't
          // occlude — so a trunk shows through surrounding leaves and leaf
          // blocks render every face. A null neighbour (boundary with no data)
          // is treated as non-occluding, so the face renders.
          const shouldCreateFace =
            neighborId === null || !registry.isOpaque(neighborId);

          if (!shouldCreateFace) return;

          // Get texture for this face
          const textureIndex = registry.getTextureForFace(blockId, faceIdx);
          const [u0, v0, u1, v1] = getTextureUVs(textureIndex);

          const [normX, normY, normZ] = face.normal;
          
          for (let i = 0; i < face.vertices.length; i++) {
            const [vx, vy, vz] = face.vertices[i];
            const [uvx, uvy] = face.uvs[i];
            
            positions.push(x + vx, y + vy, z + vz);
            normals.push(normX, normY, normZ);
            
            // Map local UV (0-1) to atlas UV
            const u = u0 + uvx * (u1 - u0);
            const v = v0 + uvy * (v1 - v0);
            uvs.push(u, v);
          }

          indices.push(vertexCount, vertexCount + 2, vertexCount + 1);
          indices.push(vertexCount, vertexCount + 3, vertexCount + 2);
          vertexCount += 4;
        });
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
  };
}

/**
 * Mesh a chunk's water into the translucent buffer with per-cell surface heights
 * (level 8 = full source, 1..7 = progressively shallower flowing water) and
 * sloped tops interpolated from neighbouring water levels. Cells with water
 * directly above render full height; surfaces against air show the level-based
 * height. Side faces render toward air or shallower water (showing the step) and
 * are culled toward opaque blocks or deeper/equal water. The water material is
 * double-sided + flat-coloured, so winding and UVs don't matter (UVs are 0).
 */
export function waterMesh(
  chunk: Chunk,
  waterLevel: Uint8Array,
  registry: BlockRegistry,
  neighborAt?: (nx: number, ny: number, nz: number) => number | null,
): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let vc = 0;
  const CS = CHUNK_SIZE;

  // Block id at a (possibly out-of-chunk) cell: in-chunk direct, else the
  // neighbour-plane sampler (-1 = unknown / no data).
  const blockAt = (lx: number, ly: number, lz: number): number => {
    if (lx >= 0 && lx < CS && ly >= 0 && ly < CS && lz >= 0 && lz < CS) {
      return chunk.getBlock(lx, ly, lz);
    }
    return neighborAt ? neighborAt(lx, ly, lz) ?? -1 : -1;
  };

  // Surface height of an in-chunk water cell (0 if not water). Full if it has
  // water directly above (it's mid-column, not a surface).
  const cellTop = (lx: number, ly: number, lz: number): number => {
    if (lx < 0 || lx >= CS || ly < 0 || ly >= CS || lz < 0 || lz >= CS) return 0;
    if (chunk.getBlock(lx, ly, lz) !== BLOCK_WATER) return 0;
    if (chunk.getBlock(lx, ly + 1, lz) === BLOCK_WATER) return 1;
    return levelToHeight(waterLevel[localIndex(lx, ly, lz)]);
  };

  // Height at a cell corner: average of the surrounding water cells' surfaces.
  const corner = (
    lx: number,
    ly: number,
    lz: number,
    di: number,
    dj: number,
    fallback: number,
  ): number => {
    let sum = 0;
    let n = 0;
    for (const cxo of [di - 1, di]) {
      for (const czo of [dj - 1, dj]) {
        const t = cellTop(lx + cxo, ly, lz + czo);
        if (t > 0) {
          sum += t;
          n++;
        }
      }
    }
    return n > 0 ? sum / n : fallback;
  };

  const quad = (
    p: number[], // 4 vertices * 3
    nx: number,
    ny: number,
    nz: number,
  ): void => {
    for (let i = 0; i < 12; i += 3) {
      positions.push(p[i], p[i + 1], p[i + 2]);
      normals.push(nx, ny, nz);
      uvs.push(0, 0);
    }
    indices.push(vc, vc + 1, vc + 2, vc, vc + 2, vc + 3);
    vc += 4;
  };

  for (let y = 0; y < CS; y++) {
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        if (chunk.getBlock(x, y, z) !== BLOCK_WATER) continue;

        const aboveWater = blockAt(x, y + 1, z) === BLOCK_WATER;
        const flat = levelToHeight(waterLevel[localIndex(x, y, z)]);
        // Corner heights (full if this is a mid-column cell).
        const h00 = aboveWater ? 1 : corner(x, y, z, 0, 0, flat);
        const h10 = aboveWater ? 1 : corner(x, y, z, 1, 0, flat);
        const h11 = aboveWater ? 1 : corner(x, y, z, 1, 1, flat);
        const h01 = aboveWater ? 1 : corner(x, y, z, 0, 1, flat);

        // Top surface (toward the air above). Skip if covered by water/opaque.
        const above = blockAt(x, y + 1, z);
        if (!aboveWater && above !== -1 && !registry.isOpaque(above)) {
          quad(
            [x, y + h00, z, x + 1, y + h10, z, x + 1, y + h11, z + 1, x, y + h01, z + 1],
            0, 1, 0,
          );
        }

        // Base of a side face toward neighbour N: 0 toward air, N's surface
        // toward shallower water (so only the exposed step renders). Returns -1
        // to mean "cull this side".
        const sideBase = (nx: number, ny: number, nz: number, edgeMax: number): number => {
          const inChunk =
            nx >= 0 && nx < CS && ny >= 0 && ny < CS && nz >= 0 && nz < CS;
          const nb = blockAt(nx, ny, nz);
          if (nb === -1) return -1; // unknown border -> cull (avoid double walls)
          if (nb === BLOCK_WATER) {
            // We only know neighbour water *levels* within this chunk. Across a
            // chunk border, assume equal height and cull — otherwise every seam
            // shows a full water wall. In-chunk, render only the exposed step.
            if (!inChunk) return -1;
            const nt = cellTop(nx, ny, nz);
            return edgeMax > nt + 1e-4 ? nt : -1;
          }
          if (registry.isOpaque(nb)) return -1;
          return 0; // air / cutout -> full side
        };

        // +X
        let b = sideBase(x + 1, y, z, Math.max(h10, h11));
        if (b >= 0)
          quad([x + 1, y + b, z, x + 1, y + b, z + 1, x + 1, y + h11, z + 1, x + 1, y + h10, z], 1, 0, 0);
        // -X
        b = sideBase(x - 1, y, z, Math.max(h00, h01));
        if (b >= 0)
          quad([x, y + b, z, x, y + b, z + 1, x, y + h01, z + 1, x, y + h00, z], -1, 0, 0);
        // +Z
        b = sideBase(x, y, z + 1, Math.max(h01, h11));
        if (b >= 0)
          quad([x, y + b, z + 1, x + 1, y + b, z + 1, x + 1, y + h11, z + 1, x, y + h01, z + 1], 0, 0, 1);
        // -Z
        b = sideBase(x, y, z - 1, Math.max(h00, h10));
        if (b >= 0)
          quad([x, y + b, z, x + 1, y + b, z, x + 1, y + h10, z, x, y + h00, z], 0, 0, -1);

        // Bottom (only when the cell below is open air).
        if (blockAt(x, y - 1, z) === BLOCK_AIR) {
          quad([x, y, z, x + 1, y, z, x + 1, y, z + 1, x, y, z + 1], 0, -1, 0);
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
  };
}
