import type { HistoryItem, DownloadState, ExportData, Word, SimilarWord } from "../shared/types";

const listEl = document.getElementById("word-list") as HTMLElement;
const countEl = document.getElementById("count") as HTMLElement;
const emptyEl = document.getElementById("empty") as HTMLElement;
const statsEl = document.getElementById("stats") as HTMLElement;

const searchInput = document.getElementById("search-input") as HTMLInputElement;
const searchResult = document.getElementById("search-result") as HTMLElement;

const exportBtn = document.getElementById("export-btn") as HTMLButtonElement;
const importBtn = document.getElementById("import-btn") as HTMLButtonElement;
const importFile = document.getElementById("import-file") as HTMLInputElement;
const importStatus = document.getElementById("import-status") as HTMLElement;

const dlSection = document.getElementById("download-section") as HTMLElement;
const dlBtn = document.getElementById("dl-btn") as HTMLButtonElement;
const dlProgress = document.getElementById("dl-progress") as HTMLElement;
const dlBar = document.getElementById("dl-bar") as HTMLElement;
const dlStatusEl = document.getElementById("dl-status") as HTMLElement;
const dlErrorEl = document.getElementById("dl-error") as HTMLElement;

const SEED_THRESHOLD = 200;
let pollTimer: ReturnType<typeof setInterval> | null = null;
const searchStack: string[] = [];

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

    const wordEl = document.createElement("a");
    wordEl.className = "word sr-link";
    wordEl.textContent = item.word;
    wordEl.dataset.word = item.word;
    wordEl.addEventListener("click", () => {
      searchInput.value = item.word;
      searchWord(item.word);
    });

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

let searchTimer: ReturnType<typeof setTimeout> | null = null;

searchInput.addEventListener("input", () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = searchInput.value.trim();
    if (q.length >= 2) {
      searchWord(q);
    } else {
      hideSearch();
    }
  }, 200);
});

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    searchInput.value = "";
    hideSearch();
  }
});

function hideSearch() {
  searchResult.classList.remove("visible");
  searchResult.innerHTML = "";
  searchStack.length = 0;
}

async function searchWord(word: string) {
  const res = await chrome.runtime.sendMessage({ type: "LOOKUP", word });

  searchResult.classList.add("visible");
  searchResult.innerHTML = "";

  if (!res.found || !res.word) {
    const similarRes = await chrome.runtime.sendMessage({ type: "GET_SIMILAR", word });
    const similar: SimilarWord[] = similarRes.words || [];

    if (similar.length > 0) {
      renderNotFound(word, similar);
    } else {
      searchResult.innerHTML = `<span class="sr-not-found">No results for "${word}"</span>`;
    }
    return;
  }

  searchStack.push(word);
  renderWord(res.word);
}

function renderWord(w: Word) {
  searchResult.innerHTML = "";

  const header = document.createElement("div");
  header.className = "sr-header";

  if (searchStack.length > 1) {
    const back = document.createElement("button");
    back.type = "button";
    back.className = "sr-back";
    back.textContent = "\u2190";
    back.addEventListener("click", () => {
      searchStack.pop();
      const prev = searchStack[searchStack.length - 1];
      searchStack.pop();
      searchInput.value = prev;
      searchWord(prev);
    });
    header.appendChild(back);
  }

  const wordEl = document.createElement("span");
  wordEl.className = "sr-word";
  wordEl.textContent = w.word;
  header.appendChild(wordEl);

  if (w.pos || w.gender) {
    const posEl = document.createElement("span");
    posEl.className = "sr-pos";
    posEl.textContent = `(${[w.pos, w.gender].filter(Boolean).join(", ")})`;
    header.appendChild(posEl);
  }

  searchResult.appendChild(header);

  if (w.definitions.length > 0) {
    const defsEl = document.createElement("div");
    defsEl.className = "sr-defs";
    for (const d of w.definitions.slice(0, 5)) {
      const defEl = document.createElement("div");
      defEl.className = "sr-def";
      const text = d.translation || d.definition;
      defEl.innerHTML = `\u2022 ${makeClickable(text)}`;
      defsEl.appendChild(defEl);
    }
    searchResult.appendChild(defsEl);
  }

  if (w.examples.length > 0) {
    const ex = w.examples[0];
    if (ex.example) {
      const exEl = document.createElement("div");
      exEl.className = "sr-example";
      exEl.textContent = `"${ex.example}"`;
      if (ex.translation) {
        exEl.textContent += ` — ${ex.translation}`;
      }
      searchResult.appendChild(exEl);
    }
  }

  chrome.runtime.sendMessage({ type: "GET_SIMILAR", word: w.word }).then((res) => {
    const similar: SimilarWord[] = (res.words || []).filter(
      (s: SimilarWord) => s.word !== w.word
    );
    if (similar.length > 0) {
      renderSimilar(similar);
    }
  });
}

function makeClickable(text: string): string {
  return text.replace(/[a-zA-ZÀ-ÿ'-]{2,}/g, (match) => {
    return `<a class="sr-link" data-word="${match}">${match}</a>`;
  });
}

function renderNotFound(word: string, similar: SimilarWord[]) {
  searchResult.innerHTML = `<span class="sr-not-found">"${word}" not found</span>`;
  if (similar.length > 0) {
    renderSimilar(similar);
  }
}

function renderSimilar(similar: SimilarWord[]) {
  const container = document.createElement("div");
  container.className = "sr-similar";

  const label = document.createElement("div");
  label.className = "sr-similar-label";
  label.textContent = "Similar words";
  container.appendChild(label);

  const wordsEl = document.createElement("div");
  wordsEl.className = "sr-similar-words";
  for (const s of similar.slice(0, 8)) {
    const link = document.createElement("a");
    link.className = "sr-link";
    link.dataset.word = s.word;
    link.textContent = s.word;
    wordsEl.appendChild(link);
  }
  container.appendChild(wordsEl);
  searchResult.appendChild(container);
}

searchResult.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (target.classList.contains("sr-link") && target.dataset.word) {
    searchInput.value = target.dataset.word;
    searchWord(target.dataset.word);
  }
});

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

exportBtn.addEventListener("click", async () => {
  const data: ExportData = await chrome.runtime.sendMessage({ type: "EXPORT_HISTORY" });
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const date = new Date().toISOString().slice(0, 10);
  const a = document.createElement("a");
  a.href = url;
  a.download = `dicfr-export-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

importBtn.addEventListener("click", () => {
  importFile.click();
});

importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data: ExportData = JSON.parse(text);

    if (data.version !== 1 || !Array.isArray(data.words)) {
      throw new Error("Invalid file format");
    }

    const result = await chrome.runtime.sendMessage({ type: "IMPORT_HISTORY", data });
    importStatus.textContent = `Imported: ${result.merged} merged, ${result.added} added`;
    importStatus.style.display = "block";
    setTimeout(() => { importStatus.style.display = "none"; }, 3000);
    loadHistory();
  } catch (err) {
    importStatus.textContent = `Import failed: ${err instanceof Error ? err.message : "unknown error"}`;
    importStatus.style.color = "#c44";
    importStatus.style.display = "block";
    setTimeout(() => {
      importStatus.style.display = "none";
      importStatus.style.color = "#4a9";
    }, 3000);
  }

  importFile.value = "";
});

loadHistory();
checkOngoingDownload();
