const DB_NAME = "voxel-sandbox";
const DB_VERSION = 1;
const STORE_NAME = "chunks";

const supportsIndexedDB = typeof indexedDB !== "undefined";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!supportsIndexedDB) {
      reject(new Error("IndexedDB not supported"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "chunkKey" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB open error"));
  });
}

export async function saveChunkBlocks(
  chunkKey: string,
  blocks: Uint16Array,
): Promise<void> {
  if (!supportsIndexedDB) return;
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put({ chunkKey, buffer: blocks.buffer.slice(0) });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write error"));
  });
}

export async function loadChunkBlocks(
  chunkKey: string,
): Promise<Uint16Array | null> {
  if (!supportsIndexedDB) return null;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(chunkKey);
    req.onsuccess = () => {
      const result = req.result as
        | { chunkKey: string; buffer: ArrayBuffer }
        | undefined;
      if (result && result.buffer) {
        resolve(new Uint16Array(result.buffer));
      } else {
        resolve(null);
      }
    };
    req.onerror = () => reject(req.error ?? new Error("IndexedDB read error"));
  });
}

export async function deleteChunk(chunkKey: string): Promise<void> {
  if (!supportsIndexedDB) return;
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.delete(chunkKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete error"));
  });
}

export async function clearChunks(): Promise<void> {
  if (!supportsIndexedDB) return;
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB clear error"));
  });
}
