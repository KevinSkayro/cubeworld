import * as THREE from "three";
import { World } from "./World";
import { Chunk } from "./Chunk";
import { CHUNK_SIZE } from "./constants";
import { loadChunkBlocks, saveChunkBlocks } from "./persistence/indexedDB";

export class ChunkManager {
  world: World;
  loadedChunks: Set<string> = new Set();
  chunkMeshes: Map<string, THREE.Mesh> = new Map();
  renderRadius: number = 4;
  scene: THREE.Scene;
  mesherWorker: Worker;
  worldgenWorker: Worker;
  seed: number;
  onMeshReady: (chunkKey: string, meshData: any) => void;

  constructor(
    world: World,
    scene: THREE.Scene,
    mesherWorker: Worker,
    worldgenWorker: Worker,
    seed: number,
    onMeshReady: (chunkKey: string, meshData: any) => void,
  ) {
    this.world = world;
    this.scene = scene;
    this.mesherWorker = mesherWorker;
    this.worldgenWorker = worldgenWorker;
    this.seed = seed;
    this.onMeshReady = onMeshReady;
  }

  onWorldgenComplete(chunkKey: string, blocks: Uint16Array) {
    const [cx, cy, cz] = chunkKey.split(",").map(Number);
    const chunk = new Chunk(cx, cy, cz);
    chunk.blocks = blocks;
    this.world.chunks.set(chunkKey, chunk);
    void saveChunkBlocks(chunkKey, blocks).catch(() => {});
    this.requestMesh(chunkKey);
  }

  update(playerX: number, playerY: number, playerZ: number) {
    const playerChunkX = Math.floor(playerX / CHUNK_SIZE);
    const playerChunkZ = Math.floor(playerZ / CHUNK_SIZE);

    const chunksToLoad: string[] = [];

    // Load chunks at ground level (cy=0) and above (cy=1) for terrain
    for (const cy of [0, 1]) {
      for (
        let cx = playerChunkX - this.renderRadius;
        cx <= playerChunkX + this.renderRadius;
        cx++
      ) {
        for (
          let cz = playerChunkZ - this.renderRadius;
          cz <= playerChunkZ + this.renderRadius;
          cz++
        ) {
          const key = `${cx},${cy},${cz}`;
          if (!this.loadedChunks.has(key)) {
            chunksToLoad.push(key);
          }
        }
      }
    }

    // Load new chunks
    for (const key of chunksToLoad) {
      const [cx, cy, cz] = key.split(",").map(Number);
      if (!this.world.chunks.has(key)) {
        // Try persistence first; if missing, request generation
        loadChunkBlocks(key)
          .then((cached) => {
            if (cached) {
              const chunk = new Chunk(cx, cy, cz);
              chunk.blocks = cached;
              this.world.chunks.set(key, chunk);
              this.requestMesh(key);
            } else {
              this.worldgenWorker.postMessage({
                chunkKey: key,
                cx,
                cy,
                cz,
                seed: this.seed,
              });
            }
          })
          .catch(() => {
            this.worldgenWorker.postMessage({
              chunkKey: key,
              cx,
              cy,
              cz,
              seed: this.seed,
            });
          });
      } else {
        // Chunk already exists, just remesh it
        this.requestMesh(key);
      }
      this.loadedChunks.add(key);
    }

    // Unload chunks outside radius
    const chunksToUnload: string[] = [];
    for (const key of this.loadedChunks) {
      const [cx, cy, cz] = key.split(",").map(Number);
      const distX = Math.abs(cx - playerChunkX);
      const distZ = Math.abs(cz - playerChunkZ);
      const dist = Math.max(distX, distZ);
      if (dist > this.renderRadius) {
        chunksToUnload.push(key);
      }
    }

    for (const key of chunksToUnload) {
      this.unloadChunk(key);
    }
  }

  requestMeshUpdate(chunkKey: string) {
    this.requestMesh(chunkKey);
  }

  private requestMesh(chunkKey: string) {
    const chunk = this.world.chunks.get(chunkKey);
    if (chunk) {
      this.mesherWorker.postMessage({
        chunkKey,
        chunkSize: CHUNK_SIZE,
        blocks: chunk.blocks,
      });
    }
  }

  private unloadChunk(chunkKey: string) {
    this.loadedChunks.delete(chunkKey);

    const mesh = this.chunkMeshes.get(chunkKey);
    if (mesh) {
      mesh.geometry.dispose();
      // Don't dispose material - it's shared across all chunks
      this.scene.remove(mesh);
      this.chunkMeshes.delete(chunkKey);
    }
  }

  setMesh(chunkKey: string, mesh: THREE.Mesh) {
    const oldMesh = this.chunkMeshes.get(chunkKey);
    if (oldMesh) {
      oldMesh.geometry.dispose();
      // Don't dispose material - it's shared across all chunks
      this.scene.remove(oldMesh);
    }
    this.chunkMeshes.set(chunkKey, mesh);
    this.scene.add(mesh);
  }
}
