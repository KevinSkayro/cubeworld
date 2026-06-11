import * as THREE from "three";
import { World } from "./World";
import { Chunk } from "./Chunk";
import { CHUNK_SIZE } from "./constants";
import { loadStoredChunk, saveEditedChunk } from "./persistence/indexedDB";
import { parseKey, chunkKey as makeChunkKey } from "./gen/coords";
import { GEN_VERSION, type WorldSettings } from "./gen/settings";
import { selectChunksToLoad, shouldUnload } from "./chunkLoadOrder";
import { collectNeighborPlanes } from "./meshing/neighbors";

export class ChunkManager {
  world: World;
  loadedChunks: Set<string> = new Set();
  chunkMeshes: Map<string, THREE.Mesh> = new Map();
  chunkWaterMeshes: Map<string, THREE.Mesh> = new Map();
  settings: WorldSettings;
  scene: THREE.Scene;
  mesherWorker: Worker;
  worldgenWorker: Worker;
  onMeshReady: (chunkKey: string, meshData: any) => void;

  // Edited-chunk writes still in flight, so a page-hide flush can await them.
  private pendingSaves = new Set<Promise<void>>();
  // Chunks edited but not yet written to storage. With auto-save off these pile
  // up until the player saves; they're kept resident (never evicted) so the
  // edits can't be lost.
  private dirtyChunks = new Set<string>();
  // Whether every edit persists immediately. Off by default — the player saves
  // manually (or opts into auto-save) from the menu.
  private autoSave = false;

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
    // The chunk may have left the render radius while generation was in flight;
    // if so, drop the result rather than inserting an orphan into world.chunks.
    if (!this.loadedChunks.has(chunkKey)) return;
    const [cx, cy, cz] = chunkKey.split(",").map(Number);
    const chunk = new Chunk(cx, cy, cz);
    chunk.blocks = blocks;
    // Generated (unedited) chunks are not persisted — they regenerate
    // deterministically, so the DB only holds player edits.
    this.world.chunks.set(chunkKey, chunk);
    this.requestMeshWithNeighbors(chunkKey);
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
        // Already generated (e.g. a pinned edited chunk re-entering range) —
        // remesh it and its neighbours so seams cull correctly.
        this.requestMeshWithNeighbors(key);
        continue;
      }

      // Only player-edited chunks are stored; if one exists, restore it
      // verbatim, otherwise (re)generate. The seed namespaces storage, so a
      // different world never returns another's chunks.
      const generate = () =>
        this.worldgenWorker.postMessage({
          chunkKey: key,
          cx,
          cy,
          cz,
          seed: this.settings.seed,
        });

      loadStoredChunk(this.settings.seed, key)
        .then((stored) => {
          // Dropped from the render radius (or already materialised) while the
          // async load was in flight — don't insert a stale/duplicate chunk.
          if (!this.loadedChunks.has(key) || this.world.chunks.has(key)) return;
          if (stored) {
            const chunk = new Chunk(cx, cy, cz);
            chunk.blocks = stored.blocks;
            chunk.edited = true;
            this.world.chunks.set(key, chunk);
            this.requestMeshWithNeighbors(key);
          } else {
            generate();
          }
        })
        .catch(generate);
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
    if (!chunk) return;
    const [cx, cy, cz] = parseKey(chunkKey);
    // Hand the mesher each loaded neighbour's border plane so it can cull the
    // hidden faces along chunk seams.
    const neighbors = collectNeighborPlanes(
      (nx, ny, nz) => this.world.chunks.get(makeChunkKey(nx, ny, nz))?.blocks,
      cx,
      cy,
      cz,
    );
    this.mesherWorker.postMessage({
      chunkKey,
      chunkSize: CHUNK_SIZE,
      blocks: chunk.blocks,
      neighbors,
    });
  }

  /**
   * Mesh a chunk and re-mesh its already-displayed neighbours, so the faces
   * along their shared seams get culled now that this chunk's blocks exist.
   * Called when a chunk's data first becomes available.
   */
  private requestMeshWithNeighbors(chunkKey: string) {
    this.requestMesh(chunkKey);
    const [cx, cy, cz] = parseKey(chunkKey);
    const neighborKeys = [
      makeChunkKey(cx + 1, cy, cz),
      makeChunkKey(cx - 1, cy, cz),
      makeChunkKey(cx, cy + 1, cz),
      makeChunkKey(cx, cy - 1, cz),
      makeChunkKey(cx, cy, cz + 1),
      makeChunkKey(cx, cy, cz - 1),
    ];
    for (const nk of neighborKeys) {
      // Only re-mesh neighbours that are actually on screen; unmeshed ones will
      // pick up this chunk when they mesh themselves.
      if (this.chunkMeshes.has(nk)) this.requestMesh(nk);
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

    const waterMesh = this.chunkWaterMeshes.get(chunkKey);
    if (waterMesh) {
      waterMesh.geometry.dispose();
      this.scene.remove(waterMesh);
      this.chunkWaterMeshes.delete(chunkKey);
    }

    // Evict the block data too, bounding memory to the loaded region — except
    // chunks with unsaved edits, which are kept resident so they can't be lost.
    // Everything else is safe to drop: unedited chunks regenerate
    // deterministically, and saved edits reload from storage on revisit.
    if (!this.dirtyChunks.has(chunkKey)) {
      this.world.chunks.delete(chunkKey);
    }
  }

  /**
   * Mark a chunk as player-edited. With auto-save on it's persisted immediately;
   * otherwise it's tracked as dirty until the player saves.
   */
  markEdited(chunkKey: string) {
    const chunk = this.world.chunks.get(chunkKey);
    if (!chunk) return;
    chunk.edited = true;
    if (this.autoSave) {
      this.persist(chunkKey);
    } else {
      this.dirtyChunks.add(chunkKey);
    }
  }

  /** Write a chunk to storage now. IndexedDB serialises writes to the same
   *  chunk, so the most recent edit is the one that ends up stored. */
  private persist(chunkKey: string) {
    const chunk = this.world.chunks.get(chunkKey);
    if (!chunk) return;
    this.dirtyChunks.delete(chunkKey);
    const save = saveEditedChunk(
      this.settings.seed,
      chunkKey,
      chunk.blocks,
      GEN_VERSION,
    )
      .catch(() => {
        // Best-effort persistence; ignore (e.g. storage disabled / quota).
      })
      .finally(() => this.pendingSaves.delete(save));
    this.pendingSaves.add(save);
  }

  /** Persist every chunk with unsaved edits. Returns how many were written. */
  saveAll(): number {
    const keys = Array.from(this.dirtyChunks);
    for (const key of keys) this.persist(key);
    return keys.length;
  }

  /** Enable/disable saving on every edit. Turning it on flushes pending edits. */
  setAutoSave(enabled: boolean) {
    this.autoSave = enabled;
    if (enabled) this.saveAll();
  }

  isAutoSaveEnabled(): boolean {
    return this.autoSave;
  }

  /** Await all in-flight edited-chunk saves (e.g. on page hide). */
  async flushSaves(): Promise<void> {
    await Promise.all(this.pendingSaves);
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

  /** Set (or clear, with null) the translucent water mesh for a chunk. */
  setWaterMesh(chunkKey: string, mesh: THREE.Mesh | null) {
    const old = this.chunkWaterMeshes.get(chunkKey);
    if (old) {
      old.geometry.dispose();
      this.scene.remove(old);
      this.chunkWaterMeshes.delete(chunkKey);
    }
    if (mesh) {
      this.chunkWaterMeshes.set(chunkKey, mesh);
      this.scene.add(mesh);
    }
  }
}
