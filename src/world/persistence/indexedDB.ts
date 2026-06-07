// Chunk persistence.
//
// Only *edited* chunks are stored: generated terrain is deterministic and cheap
// to reproduce, so the database holds just what the player has actually changed.
// This keeps storage tiny and lets generator changes show up immediately in
// unedited areas (they're always regenerated, never served from a stale cache).
//
// Records are namespaced by seed, so switching worlds never collides, and carry
// the generator version for forensics/migration. We never discard a player's
// edited chunk on a version bump — their world is theirs.

const DB_NAME = "voxel-sandbox";
// v2: dropped the old "cache every generated chunk" store. The v1 store only
// ever held generated chunks (edits were never persisted under v1), so clearing
// it on upgrade loses no player data — it just frees the bloat and lets the
// latest generator (e.g. new structures) regenerate.
const DB_VERSION = 2;
const STORE_NAME = "chunks";

const supportsIndexedDB = typeof indexedDB !== "undefined";

/** Storage key for a chunk in a given world. Namespacing by seed keeps separate
 *  worlds from colliding on the same "cx,cy,cz" chunk key. Pure + exported so
 *  the namespacing scheme is unit-testable. */
export function storageKey(seed: number, chunkKey: string): string {
  return `${seed}:${chunkKey}`;
}

export interface StoredChunk {
  blocks: Uint16Array;
  /** Generator version the chunk was saved under. */
  version: number;
  /** Always true today (only edited chunks are stored); explicit for clarity
   *  and in case generated chunks are ever cached again. */
  edited: boolean;
}

interface ChunkRecord {
  key: string; // seed-namespaced storage key (keyPath)
  chunkKey: string; // plain "cx,cy,cz" (for debugging)
  seed: number;
  version: number;
  edited: boolean;
  buffer: ArrayBuffer;
}

// One shared connection, opened lazily.
let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!supportsIndexedDB) {
      reject(new Error("IndexedDB not supported"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      // Recreate the store: drops the v1 generated-chunk cache (no edits lost,
      // see DB_VERSION note) and switches to the seed-namespaced keyPath.
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
      db.createObjectStore(STORE_NAME, { keyPath: "key" });
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB open error"));
  });
}

function getDB(): Promise<IDBDatabase> {
  if (!dbPromise) dbPromise = openDB();
  return dbPromise;
}

/** Persist a player-edited chunk for a world. */
export async function saveEditedChunk(
  seed: number,
  chunkKey: string,
  blocks: Uint16Array,
  version: number,
): Promise<void> {
  if (!supportsIndexedDB) return;
  const db = await getDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const record: ChunkRecord = {
      key: storageKey(seed, chunkKey),
      chunkKey,
      seed,
      version,
      edited: true,
      buffer: blocks.buffer.slice(0),
    };
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write error"));
  });
}

/** Load a stored (edited) chunk for a world, or null if there is none. */
export async function loadStoredChunk(
  seed: number,
  chunkKey: string,
): Promise<StoredChunk | null> {
  if (!supportsIndexedDB) return null;
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(storageKey(seed, chunkKey));
    req.onsuccess = () => {
      const result = req.result as ChunkRecord | undefined;
      if (result && result.buffer) {
        resolve({
          blocks: new Uint16Array(result.buffer),
          version: result.version,
          edited: result.edited,
        });
      } else {
        resolve(null);
      }
    };
    req.onerror = () => reject(req.error ?? new Error("IndexedDB read error"));
  });
}

/** Remove a stored chunk (e.g. when a player-edited chunk reverts to generated). */
export async function deleteStoredChunk(
  seed: number,
  chunkKey: string,
): Promise<void> {
  if (!supportsIndexedDB) return;
  const db = await getDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(storageKey(seed, chunkKey));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete error"));
  });
}

/** Wipe all stored chunks (all worlds). */
export async function clearAll(): Promise<void> {
  if (!supportsIndexedDB) return;
  const db = await getDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB clear error"));
  });
}
