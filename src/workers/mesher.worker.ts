import { BlockRegistry } from "../world/BlockRegistry";
import { Chunk } from "../world/Chunk";
import { naiveMesh } from "../world/meshing/naiveMesh";
import { makeNeighborSampler } from "../world/meshing/neighbors";
import {
  MesherWorkerRequest,
  MesherWorkerResponse,
} from "../world/meshing/types";

const registry = new BlockRegistry();

self.onmessage = (event: MessageEvent<MesherWorkerRequest>) => {
  const { chunkKey, blocks, neighbors } = event.data;

  // Reconstruct chunk from blocks array
  const chunk = new Chunk(0, 0, 0);
  chunk.blocks = blocks;

  // Generate mesh, culling chunk-border faces against the neighbour planes.
  const meshData = naiveMesh(chunk, registry, makeNeighborSampler(neighbors));

  // Send back with transferable buffers
  const response: MesherWorkerResponse = {
    chunkKey,
    meshData,
  };

  const transfers = [
    meshData.positions.buffer,
    meshData.normals.buffer,
    meshData.uvs.buffer,
    meshData.indices.buffer,
  ];

  self.postMessage(response, transfers);
};
