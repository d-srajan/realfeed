/**
 * IndexedDB-based cache for analysis results.
 * Keyed by post content hash to avoid re-analyzing identical content.
 */

const DB_NAME = 'ai-content-detector';
const DB_VERSION = 1;
const STORE_NAME = 'results';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'hash' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

/**
 * Generate a simple hash from post content for cache keying.
 * Uses a fast non-crypto hash (FNV-1a).
 */
export function hashContent(text) {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0; // FNV prime, keep as uint32
  }
  return hash.toString(16);
}

/**
 * Get a cached result by content hash.
 * Returns null if not found or expired.
 */
export async function get(hash) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(hash);

      request.onsuccess = () => {
        const result = request.result;
        if (!result) {
          resolve(null);
          return;
        }
        // Check expiry
        if (Date.now() - result.timestamp > MAX_AGE_MS) {
          // Expired — clean up async, return null
          del(hash);
          resolve(null);
          return;
        }
        resolve(result.data);
      };

      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

/**
 * Store an analysis result in cache.
 */
export async function set(hash, data) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({ hash, data, timestamp: Date.now() });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Cache write failure is non-fatal
  }
}

/**
 * Delete a cached entry.
 */
export async function del(hash) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(hash);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Non-fatal
  }
}

/**
 * Purge all expired entries. Call periodically (e.g. on extension startup).
 */
export async function purgeExpired() {
  try {
    const db = await openDB();
    const cutoff = Date.now() - MAX_AGE_MS;

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('timestamp');
      const range = IDBKeyRange.upperBound(cutoff);
      const request = index.openCursor(range);

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Non-fatal
  }
}
