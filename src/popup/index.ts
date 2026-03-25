import type { HistoryItem, DownloadState } from "../shared/types";

const listEl = document.getElementById("word-list") as HTMLElement;
const countEl = document.getElementById("count") as HTMLElement;
const emptyEl = document.getElementById("empty") as HTMLElement;
const statsEl = document.getElementById("stats") as HTMLElement;

const dlSection = document.getElementById("download-section") as HTMLElement;
const dlBtn = document.getElementById("dl-btn") as HTMLButtonElement;
const dlProgress = document.getElementById("dl-progress") as HTMLElement;
const dlBar = document.getElementById("dl-bar") as HTMLElement;
const dlStatusEl = document.getElementById("dl-status") as HTMLElement;
const dlErrorEl = document.getElementById("dl-error") as HTMLElement;

const SEED_THRESHOLD = 200;
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function loadHistory() {
  const [historyRes, statsRes] = await Promise.all([
    chrome.runtime.sendMessage({ type: "GET_HISTORY" }),
    chrome.runtime.sendMessage({ type: "GET_STATS" }),
  ]);

  const items: HistoryItem[] = historyRes.items || [];
  const dictSize: number = statsRes.dictSize || 0;

  if (statsRes.dbReady) {
    statsEl.textContent = `${dictSize.toLocaleString()} words in dictionary`;
  } else {
    statsEl.textContent = "Dictionary not loaded";
  }

  if (dictSize < SEED_THRESHOLD) {
    dlSection.classList.add("visible");
  } else {
    dlSection.classList.remove("visible");
  }

  countEl.textContent = `${items.length} looked up`;

  if (items.length === 0) {
    emptyEl.style.display = "block";
    listEl.innerHTML = "";
    return;
  }

  emptyEl.style.display = "none";
  listEl.innerHTML = "";

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "word-item";

    const wordEl = document.createElement("span");
    wordEl.className = "word";
    wordEl.textContent = item.word;

    const defEl = document.createElement("span");
    defEl.className = "definition";
    defEl.textContent = item.definition;

    const metaEl = document.createElement("div");
    metaEl.className = "meta";

    const timeEl = document.createElement("span");
    timeEl.className = "time";
    timeEl.textContent = formatTime(item.lastLookedUpAt);

    const countBadge = document.createElement("span");
    countBadge.className = "lookup-count";
    countBadge.textContent = `${item.lookupCount}\u00d7`;

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.type = "button";
    deleteBtn.textContent = "\u00d7";
    deleteBtn.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "DELETE_HISTORY", id: item.id });
      loadHistory();
    });

    metaEl.appendChild(timeEl);
    metaEl.appendChild(countBadge);

    row.appendChild(wordEl);
    row.appendChild(defEl);
    row.appendChild(metaEl);
    row.appendChild(deleteBtn);
    listEl.appendChild(row);
  }
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function updateDownloadUI(state: DownloadState) {
  dlErrorEl.textContent = "";

  switch (state.status) {
    case "downloading":
      dlBtn.disabled = true;
      dlBtn.textContent = "Downloading...";
      dlProgress.classList.add("visible");
      if (state.progress > 0) {
        dlBar.style.width = `${state.progress}%`;
        dlStatusEl.textContent = `${state.progress}% — ${formatBytes(state.bytesLoaded || 0)}`;
      } else {
        dlBar.style.width = "0%";
        dlStatusEl.textContent = `${formatBytes(state.bytesLoaded || 0)} downloaded`;
      }
      break;

    case "processing":
      dlBtn.disabled = true;
      dlBtn.textContent = "Loading...";
      dlBar.style.width = "100%";
      dlStatusEl.textContent = "Loading into SQLite...";
      break;

    case "complete":
      dlBtn.disabled = false;
      dlBtn.textContent = "Done!";
      dlProgress.classList.remove("visible");
      stopPolling();
      loadHistory();
      break;

    case "error":
      dlBtn.disabled = false;
      dlBtn.textContent = "Retry";
      dlProgress.classList.remove("visible");
      dlErrorEl.textContent = state.error || "Download failed";
      stopPolling();
      break;

    default:
      dlBtn.disabled = false;
      dlBtn.textContent = "Download Dictionary";
      dlProgress.classList.remove("visible");
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    const state: DownloadState = await chrome.runtime.sendMessage({
      type: "GET_DOWNLOAD_STATUS",
    });
    updateDownloadUI(state);
  }, 500);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

dlBtn.addEventListener("click", async () => {
  dlErrorEl.textContent = "";
  dlBtn.disabled = true;
  await chrome.runtime.sendMessage({ type: "START_DOWNLOAD" });
  startPolling();
});

async function checkOngoingDownload() {
  const state: DownloadState = await chrome.runtime.sendMessage({
    type: "GET_DOWNLOAD_STATUS",
  });
  if (state.status === "downloading" || state.status === "processing") {
    dlSection.classList.add("visible");
    updateDownloadUI(state);
    startPolling();
  }
}

loadHistory();
checkOngoingDownload();
