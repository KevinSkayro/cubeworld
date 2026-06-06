import { generateChunk } from "../world/gen/ChunkGenerator";

export interface WorldgenWorkerRequest {
  chunkKey: string;
  cx: number;
  cy: number;
  cz: number;
  seed: number;
}

export interface WorldgenWorkerResponse {
  chunkKey: string;
  blocks: Uint16Array;
}

self.onmessage = (event: MessageEvent<WorldgenWorkerRequest>) => {
  const { chunkKey, cx, cy, cz, seed } = event.data;

  // Generate terrain
  const blocks = generateChunk(cx, cy, cz, seed);

  const response: WorldgenWorkerResponse = {
    chunkKey,
    blocks,
  };

  self.postMessage(response, [blocks.buffer]);
};
