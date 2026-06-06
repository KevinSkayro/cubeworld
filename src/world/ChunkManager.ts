import * as THREE from "three";
import { World } from "./World";
import { Chunk } from "./Chunk";
import { CHUNK_SIZE } from "./constants";
import { loadChunkBlocks, saveChunkBlocks } from "./persistence/indexedDB";
import { parseKey } from "./gen/coords";
import type { WorldSettings } from "./gen/settings";
import { selectChunksToLoad, shouldUnload } from "./chunkLoadOrder";

export class ChunkManager {
  world: World;
  loadedChunks: Set<string> = new Set();
  chunkMeshes: Map<string, THREE.Mesh> = new Map();
  settings: WorldSettings;
  scene: THREE.Scene;
  mesherWorker: Worker;
  worldgenWorker: Worker;
  onMeshReady: (chunkKey: string, meshData: any) => void;

  constructor(
    world: World,
    scene: THREE.Scene,
    mesherWorker: Worker,
    worldgenWorker: Worker,
    settings: WorldSettings,
    onMeshReady: (chunkKey: string, meshData: any) => void,
  ) {
    this.world = world;
    this.scene = scene;
    this.mesherWorker = mesherWorker;
    this.worldgenWorker = worldgenWorker;
    this.settings = settings;
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
    const pcx = Math.floor(playerX / CHUNK_SIZE);
    const pcy = Math.floor(playerY / CHUNK_SIZE);
    const pcz = Math.floor(playerZ / CHUNK_SIZE);

    // Dispatch up to chunkLoadBudget nearest unloaded chunks this tick. The
    // closest chunks load first, and priority is recomputed every tick so the
    // player's surroundings stay current as they move.
    const toLoad = selectChunksToLoad(pcx, pcy, pcz, this.settings, (k) =>
      this.loadedChunks.has(k),
    );

    for (const key of toLoad) {
      const [cx, cy, cz] = parseKey(key);
      this.loadedChunks.add(key);

      if (this.world.chunks.has(key)) {
        // Already generated (e.g. revisited after unload) — just remesh.
        this.requestMesh(key);
        continue;
      }

      // Try persistence first; if missing, request generation.
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
              seed: this.settings.seed,
            });
          }
        })
        .catch(() => {
          this.worldgenWorker.postMessage({
            chunkKey: key,
            cx,
            cy,
            cz,
            seed: this.settings.seed,
          });
        });
    }

    // Unload chunks outside the current render radius / vertical range.
    const chunksToUnload: string[] = [];
    for (const key of this.loadedChunks) {
      if (shouldUnload(key, pcx, pcz, this.settings)) {
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
