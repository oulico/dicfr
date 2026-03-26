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
import type { Message, DownloadState } from "../shared/types";

const DICTIONARY_URL =
  "https://github.com/oulico/dicfr/releases/download/dict-v1/french-dictionary.db";

const KEEP_ALIVE_ALARM = "dicfr-keep-alive";

let downloadState: DownloadState = { status: "idle", progress: 0 };

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

    default:
      return { error: "Unknown message type" };
  }
}
