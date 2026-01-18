import { Chunk } from "../Chunk";
import { BlockRegistry } from "../BlockRegistry";
import { CHUNK_SIZE } from "../constants";
import { getTextureUVs } from "../textureConfig";

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

export function naiveMesh(chunk: Chunk, registry: BlockRegistry): MeshData {
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

          let shouldCreateFace = false;
          
          if (!inBounds) {
            // At chunk boundary - always create face
            shouldCreateFace = true;
          } else {
            const neighborId = chunk.getBlock(nx, ny, nz);
            if (!registry.isSolid(neighborId)) {
              shouldCreateFace = true;
            }
          }

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
