import { Chunk } from "../Chunk";
import { BlockRegistry } from "../BlockRegistry";
import { CHUNK_SIZE } from "../constants";
import { getTextureUVs } from "../textures/config";

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
 * Mesh the translucent blocks (water) of a chunk into a separate buffer for the
 * blended render pass. A water face is rendered toward air (or an unknown
 * neighbour) and culled toward another water block (internal) or an opaque block
 * (hidden). UVs are zero — the water material is a flat colour with no texture.
 */
export function waterMesh(
  chunk: Chunk,
  registry: BlockRegistry,
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
        if (!registry.isTranslucent(blockId)) continue;

        const neighbors = [
          { nx: x + 1, ny: y, nz: z },
          { nx: x - 1, ny: y, nz: z },
          { nx: x, ny: y + 1, nz: z },
          { nx: x, ny: y - 1, nz: z },
          { nx: x, ny: y, nz: z + 1 },
          { nx: x, ny: y, nz: z - 1 },
        ];

        CUBE_FACES.forEach((face, faceIdx) => {
          const { nx, ny, nz } = neighbors[faceIdx];
          const inBounds =
            nx >= 0 &&
            nx < CHUNK_SIZE &&
            ny >= 0 &&
            ny < CHUNK_SIZE &&
            nz >= 0 &&
            nz < CHUNK_SIZE;

          const neighborId = inBounds
            ? chunk.getBlock(nx, ny, nz)
            : neighborAt
              ? neighborAt(nx, ny, nz)
              : null;

          // Cull internal water↔water faces and faces hidden behind opaque
          // blocks; render the rest (the water surface and edges against air).
          const cull =
            neighborId === blockId ||
            (neighborId !== null && registry.isOpaque(neighborId));
          if (cull) return;

          const [normX, normY, normZ] = face.normal;
          for (let i = 0; i < face.vertices.length; i++) {
            const [vx, vy, vz] = face.vertices[i];
            positions.push(x + vx, y + vy, z + vz);
            normals.push(normX, normY, normZ);
            uvs.push(0, 0);
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
