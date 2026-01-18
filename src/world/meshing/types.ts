export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

export interface MesherWorkerRequest {
  chunkKey: string;
  chunkSize: number;
  blocks: Uint16Array;
}

export interface MesherWorkerResponse {
  chunkKey: string;
  meshData: MeshData;
}
