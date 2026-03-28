import {
  initSqlite,
  hasLocalDB,
  loadSeedSQL,
  loadFromBuffer,
  getDictSize,
  getHistory,
  getHistoryCount,
  deleteHistory,
  getSimilarWords,
  exportHistory,
  importHistory,
} from "../db";
import { lookupAndSave } from "../core/lookup";
import type { Message, DownloadState, ExportData } from "../shared/types";

const DICTIONARY_URL =
  "https://github.com/oulico/dicfr/releases/download/dict-v1/french-dictionary.db";

const API_URL = "https://dicfr-api.manemis.workers.dev";
const KEEP_ALIVE_ALARM = "dicfr-keep-alive";

let downloadState: DownloadState = { status: "idle", progress: 0 };

interface SyncStatus {
  loggedIn: boolean;
  email?: string;
  lastSyncedAt?: string;
}

let syncStatus: SyncStatus = { loggedIn: false };

async function getAuthToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || "Auth failed"));
      } else {
        resolve(token);
      }
    });
  });
}

async function syncLogin(): Promise<SyncStatus> {
  const token = await getAuthToken();
  const res = await fetch(`${API_URL}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new Error("Auth failed");
  const { user } = await res.json() as { user: { email: string } };
  syncStatus = { loggedIn: true, email: user.email };
  await chrome.storage.local.set({ syncToken: token, syncEmail: user.email });
  return syncStatus;
}

async function syncLogout(): Promise<SyncStatus> {
  await chrome.storage.local.remove(["syncToken", "syncEmail"]);
  chrome.identity.removeCachedAuthToken({ token: "" });
  syncStatus = { loggedIn: false };
  return syncStatus;
}

async function getSavedToken(): Promise<string | null> {
  const { syncToken, syncEmail } = await chrome.storage.local.get(["syncToken", "syncEmail"]);
  if (syncToken && syncEmail) {
    syncStatus = { loggedIn: true, email: syncEmail };
    return syncToken;
  }
  return null;
}

async function syncPush(): Promise<{ synced: number }> {
  const token = await getSavedToken();
  if (!token) throw new Error("Not logged in");

  const data = await exportHistory();
  const res = await fetch(`${API_URL}/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ words: data.words }),
  });
  if (!res.ok) throw new Error(`Sync push failed: ${res.status}`);
  const result = await res.json() as { synced: number };
  syncStatus.lastSyncedAt = new Date().toISOString();
  return result;
}

async function syncPull(): Promise<{ merged: number; added: number }> {
  const token = await getSavedToken();
  if (!token) throw new Error("Not logged in");

  const res = await fetch(`${API_URL}/sync`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Sync pull failed: ${res.status}`);
  const data = await res.json() as ExportData;
  const result = await importHistory(data);
  syncStatus.lastSyncedAt = new Date().toISOString();
  return result;
}

async function init() {
  try {
    await initSqlite();

    if (!hasLocalDB()) {
      const url = chrome.runtime.getURL("data/seed.sql");
      const resp = await fetch(url);
      if (resp.ok) {
        const sql = await resp.text();
        await loadSeedSQL(sql);
      }
    }

    console.log(`[dicfr] Ready — ${getDictSize()} words`);
  } catch (err) {
    console.error("[dicfr] Init failed:", err);
  }
}

chrome.runtime.onInstalled.addListener(() => init());
chrome.runtime.onStartup.addListener(() => init());

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEP_ALIVE_ALARM) {
    const active =
      downloadState.status === "downloading" ||
      downloadState.status === "processing";
    console.log(`[dicfr] keep-alive tick (downloading=${active})`);
    if (!active) {
      chrome.alarms.clear(KEEP_ALIVE_ALARM);
    }
  }
});

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  handleMessage(msg)
    .then(sendResponse)
    .catch((err) => {
      console.error("[dicfr] Handler error:", err);
      sendResponse({ error: String(err) });
    });
  return true;
});

async function startDownload(): Promise<DownloadState> {
  if (downloadState.status === "downloading" || downloadState.status === "processing") {
    return downloadState;
  }

  downloadState = { status: "downloading", progress: 0, bytesLoaded: 0 };

  chrome.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 0.45 });
  console.log(`[dicfr] Downloading: ${DICTIONARY_URL}`);

  try {
    const response = await fetch(DICTIONARY_URL);
    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const contentLength = response.headers.get("Content-Length");
    const totalSize = contentLength ? parseInt(contentLength, 10) : 0;
    console.log(`[dicfr] Content-Length: ${totalSize} (${(totalSize / 1024 / 1024).toFixed(1)} MB)`);

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      loaded += value.length;

      const progress = totalSize > 0
        ? Math.min(99, Math.round((loaded / totalSize) * 100))
        : 0;
      downloadState = { status: "downloading", progress, bytesLoaded: loaded };
    }

    downloadState = { status: "processing", progress: 100, bytesLoaded: loaded };
    console.log(`[dicfr] Download done: ${(loaded / 1024 / 1024).toFixed(1)}MB — loading into SQLite...`);

    const combined = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    await loadFromBuffer(combined.buffer);
    downloadState = { status: "complete", progress: 100, bytesLoaded: loaded };
    console.log(`[dicfr] Dictionary loaded — ${getDictSize()} words`);
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    downloadState = { status: "error", progress: 0, error: error.message };
    console.error("[dicfr] Download failed:", error);
  } finally {
    chrome.alarms.clear(KEEP_ALIVE_ALARM);
  }

  return downloadState;
}

async function handleMessage(msg: Message) {
  await initSqlite();

  switch (msg.type) {
    case "LOOKUP":
      return lookupAndSave(msg.word);

    case "GET_HISTORY": {
      const items = await getHistory();
      return { items };
    }

    case "GET_STATS": {
      const [dictSize, historyCount] = await Promise.all([
        getDictSize(),
        getHistoryCount(),
      ]);
      return { dictSize, historyCount, dbReady: hasLocalDB() };
    }

    case "DELETE_HISTORY": {
      await deleteHistory(msg.id);
      return { success: true };
    }

    case "GET_SIMILAR":
      return { words: getSimilarWords(msg.word) };

    case "START_DOWNLOAD":
      startDownload();
      return { started: true };

    case "GET_DOWNLOAD_STATUS":
      return downloadState;

    case "EXPORT_HISTORY":
      return exportHistory();

    case "IMPORT_HISTORY": {
      const result = await importHistory(msg.data);
      return result;
    }

    case "SYNC_LOGIN":
      return syncLogin();

    case "SYNC_LOGOUT":
      return syncLogout();

    case "SYNC_PUSH":
      return syncPush();

    case "SYNC_PULL": {
      const pullResult = await syncPull();
      return pullResult;
    }

    case "GET_SYNC_STATUS": {
      await getSavedToken();
      return syncStatus;
    }

    default:
      return { error: "Unknown message type" };
  }
}
