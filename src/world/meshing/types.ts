export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

/**
 * The 16x16 block plane of each axis-neighbour adjacent to the chunk being
 * meshed, used to cull faces at chunk borders. Any side may be absent (that
 * neighbour isn't loaded yet) — its border faces are then rendered.
 */
export interface NeighborPlanes {
  xPos?: Uint16Array;
  xNeg?: Uint16Array;
  yPos?: Uint16Array;
  yNeg?: Uint16Array;
  zPos?: Uint16Array;
  zNeg?: Uint16Array;
}

export interface MesherWorkerRequest {
  chunkKey: string;
  chunkSize: number;
  blocks: Uint16Array;
  /** Neighbour border planes for cross-chunk face culling (optional). */
  neighbors?: NeighborPlanes;
}

export interface MesherWorkerResponse {
  chunkKey: string;
  meshData: MeshData;
  /** Translucent (water) geometry for the blended render pass. */
  waterMeshData: MeshData;
}
