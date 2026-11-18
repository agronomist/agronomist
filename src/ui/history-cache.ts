import type { History } from "../data/history";
import { packHistory, unpackHistory, type PackedHistory } from "../data/history-pack";

/**
 * Weather records kept in the browser (IndexedDB), so a place the visitor has already loaded costs no request next time.
 * Past weather does not change; a record is kept for 14 days because its last week does.
 */
const DB = "agronomist-weather";
const STORE = "history";
const MAX_AGE_MS = 14 * 86400000;

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function cacheGet(key: string): Promise<History | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const q = db.transaction(STORE).objectStore(STORE).get(key);
      q.onsuccess = () => {
        const v = q.result as { at: number; h: PackedHistory } | undefined;
        resolve(v && Date.now() - v.at < MAX_AGE_MS ? unpackHistory(v.h) : null);
      };
      q.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function cachePut(key: string, h: History): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    db.transaction(STORE, "readwrite").objectStore(STORE).put({ at: Date.now(), h: packHistory(h) }, key);
  } catch {
    /* storage full or blocked: carry on without it */
  }
}
