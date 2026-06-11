import { BlockRegistry } from "../world/BlockRegistry";
import { Chunk } from "../world/Chunk";
import { naiveMesh, waterMesh } from "../world/meshing/naiveMesh";
import { makeNeighborSampler } from "../world/meshing/neighbors";
import {
  MesherWorkerRequest,
  MesherWorkerResponse,
} from "../world/meshing/types";

const registry = new BlockRegistry();

self.onmessage = (event: MessageEvent<MesherWorkerRequest>) => {
  const { chunkKey, blocks, waterLevel, neighbors } = event.data;

  // Reconstruct chunk from blocks array
  const chunk = new Chunk(0, 0, 0);
  chunk.blocks = blocks;
  if (waterLevel) chunk.waterLevel = waterLevel;

  // Generate mesh, culling chunk-border faces against the neighbour planes.
  const sampler = makeNeighborSampler(neighbors);
  const meshData = naiveMesh(chunk, registry, sampler);
  const waterMeshData = waterMesh(chunk, chunk.waterLevel, registry, sampler);

  // Send back with transferable buffers
  const response: MesherWorkerResponse = {
    chunkKey,
    meshData,
    waterMeshData,
  };

  const transfers = [
    meshData.positions.buffer,
    meshData.normals.buffer,
    meshData.uvs.buffer,
    meshData.indices.buffer,
    waterMeshData.positions.buffer,
    waterMeshData.normals.buffer,
    waterMeshData.uvs.buffer,
    waterMeshData.indices.buffer,
  ];

  self.postMessage(response, transfers);
};
