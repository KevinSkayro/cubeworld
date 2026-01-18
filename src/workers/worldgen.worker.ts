import { generateChunkTerrain } from "../world/gen/terrain";

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
  const blocks = generateChunkTerrain(cx, cy, cz, seed);

  const response: WorldgenWorkerResponse = {
    chunkKey,
    blocks,
  };

  self.postMessage(response, [blocks.buffer]);
};
