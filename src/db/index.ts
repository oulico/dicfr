import initSqlJs, { type Database, type SqlValue } from "sql.js";
import { openDB, type IDBPDatabase } from "idb";
import type { Word, SimilarWord, HistoryItem } from "../shared/types";

let db: Database | null = null;
let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;

const IDB_NAME = "dicfr-storage";
const IDB_VERSION = 2;
const IDB_SQLITE_STORE = "sqlite-store";
const IDB_SQLITE_KEY = "dictionary-db";
const IDB_HISTORY_STORE = "history-store";

async function getIDB(): Promise<IDBPDatabase> {
  return openDB(IDB_NAME, IDB_VERSION, {
    upgrade(idb, oldVersion) {
      if (oldVersion < 1) {
        if (!idb.objectStoreNames.contains(IDB_SQLITE_STORE)) {
          idb.createObjectStore(IDB_SQLITE_STORE);
        }
      }
      if (oldVersion < 2) {
        if (!idb.objectStoreNames.contains(IDB_HISTORY_STORE)) {
          const store = idb.createObjectStore(IDB_HISTORY_STORE, {
            keyPath: "id",
          });
          store.createIndex("normalizedWord", "normalizedWord");
          store.createIndex("lastLookedUpAt", "lastLookedUpAt");
        }
      }
    },
  });
}

async function loadSqliteFromIDB(): Promise<Uint8Array | null> {
  try {
    const idb = await getIDB();
    const data = await idb.get(IDB_SQLITE_STORE, IDB_SQLITE_KEY);
    if (!data) return null;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (data instanceof Uint8Array) return data;
    return null;
  } catch {
    return null;
  }
}

async function saveSqliteToIDB(): Promise<void> {
  if (!db) return;
  const data = db.export();
  const idb = await getIDB();
  await idb.put(IDB_SQLITE_STORE, data.buffer, IDB_SQLITE_KEY);
}

export async function initSqlite(): Promise<void> {
  if (db) return;

  if (!SQL) {
    const wasmUrl = chrome.runtime.getURL("wasm/sql-wasm.wasm");
    SQL = await initSqlJs({ locateFile: () => wasmUrl });
  }

  const saved = await loadSqliteFromIDB();
  if (saved && saved.length > 0) {
    db = new SQL.Database(saved);
    console.log("[dicfr] Loaded dictionary from IndexedDB");
  } else {
    db = new SQL.Database();
    console.log("[dicfr] Empty database created");
  }
}

export async function loadFromBuffer(buffer: ArrayBuffer): Promise<void> {
  if (!SQL) await initSqlite();
  if (db) db.close();
  db = new SQL!.Database(new Uint8Array(buffer));
  await saveSqliteToIDB();
  console.log("[dicfr] Loaded database from buffer");
}

export async function loadSeedSQL(sql: string): Promise<void> {
  if (!db) await initSqlite();
  db!.run(sql);
  await saveSqliteToIDB();
  console.log("[dicfr] Seed data loaded");
}

function execQuery(sql: string, params: SqlValue[] = []): Record<string, unknown>[] {
  if (!db) throw new Error("Database not initialized");
  const results: Record<string, unknown>[] = [];
  const stmt = db.prepare(sql);
  stmt.bind(params);
  while (stmt.step()) {
    results.push(stmt.getAsObject() as Record<string, unknown>);
  }
  stmt.free();
  return results;
}

function parseJSONField(field: unknown): unknown[] {
  if (Array.isArray(field)) return field;
  if (!field || field === "" || field === "null") return [];
  const str = String(field);
  if (str.startsWith("[")) {
    try {
      const parsed = JSON.parse(str);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function getWord(word: string): Word | null {
  try {
    const rows = execQuery(
      `SELECT id, word, pos, gender, definitions, examples
       FROM french_dictionary WHERE word = ? LIMIT 1`,
      [word.toLowerCase()]
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: Number(r.id),
      word: r.word as string,
      pos: (r.pos as string) || null,
      gender: (r.gender as string) || null,
      definitions: parseJSONField(r.definitions) as Word["definitions"],
      examples: parseJSONField(r.examples) as Word["examples"],
    };
  } catch {
    return null;
  }
}

export function getSimilarWords(term: string): SimilarWord[] {
  const normalized = term.toLowerCase();
  try {
    let rows: Record<string, unknown>[];
    if (normalized.length >= 3) {
      try {
        rows = execQuery(
          `SELECT d.id, d.word
           FROM french_dictionary_fts fts
           JOIN french_dictionary d ON fts.rowid = d.id
           WHERE fts.word MATCH ? || '*'
           ORDER BY rank LIMIT 10`,
          [normalized]
        );
      } catch {
        rows = execQuery(
          `SELECT id, word FROM french_dictionary
           WHERE word LIKE ? || '%' ORDER BY length(word), word LIMIT 10`,
          [normalized]
        );
      }
    } else {
      rows = execQuery(
        `SELECT id, word FROM french_dictionary
         WHERE word LIKE ? || '%' ORDER BY length(word), word LIMIT 10`,
        [normalized]
      );
    }
    return rows.map((r) => ({ id: Number(r.id), word: r.word as string }));
  } catch {
    return [];
  }
}

export function hasLocalDB(): boolean {
  if (!db) return false;
  try {
    const check = execQuery(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name='french_dictionary' LIMIT 1`
    );
    if (check.length === 0) return false;
    const count = execQuery("SELECT COUNT(*) as c FROM french_dictionary");
    return Number(count[0]?.c || 0) > 0;
  } catch {
    return false;
  }
}

export function getDictSize(): number {
  if (!db) return 0;
  try {
    const rows = execQuery("SELECT COUNT(*) as c FROM french_dictionary");
    return Number(rows[0]?.c || 0);
  } catch {
    return 0;
  }
}

export async function saveHistory(word: string, definition: string): Promise<HistoryItem> {
  const idb = await getIDB();
  const normalizedWord = word.toLowerCase();
  const existing = await idb.getFromIndex(IDB_HISTORY_STORE, "normalizedWord", normalizedWord);

  if (existing && existing.normalizedWord === normalizedWord) {
    const updated: HistoryItem = {
      ...existing,
      lookupCount: existing.lookupCount + 1,
      lastLookedUpAt: Date.now(),
    };
    await idb.put(IDB_HISTORY_STORE, updated);
    return updated;
  }

  const item: HistoryItem = {
    id: crypto.randomUUID(),
    word,
    normalizedWord,
    definition,
    lookupCount: 1,
    lastLookedUpAt: Date.now(),
    createdAt: Date.now(),
  };
  await idb.add(IDB_HISTORY_STORE, item);
  return item;
}

export async function getHistory(): Promise<HistoryItem[]> {
  const idb = await getIDB();
  const items: HistoryItem[] = await idb.getAll(IDB_HISTORY_STORE);
  items.sort((a, b) => b.lastLookedUpAt - a.lastLookedUpAt);
  return items.slice(0, 100);
}

export async function getHistoryCount(): Promise<number> {
  const idb = await getIDB();
  return idb.count(IDB_HISTORY_STORE);
}

export async function deleteHistory(id: string): Promise<void> {
  const idb = await getIDB();
  await idb.delete(IDB_HISTORY_STORE, id);
}
