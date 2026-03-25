import type { LookupResponse, Word } from "../shared/types";

const TOOLTIP_ID = "dicfr-tooltip";
let activeTooltip: HTMLElement | null = null;

function removeTooltip() {
  if (activeTooltip) {
    activeTooltip.remove();
    activeTooltip = null;
  }
}

function formatTooltipHTML(word: Word): string {
  let html = `<strong>${word.word}</strong>`;

  if (word.pos || word.gender) {
    const meta = [word.pos, word.gender].filter(Boolean).join(", ");
    html += ` <span style="color:#888;font-size:11px">(${meta})</span>`;
  }

  if (word.definitions.length > 0) {
    const defs = word.definitions.slice(0, 3);
    html += '<div style="margin-top:4px">';
    for (const d of defs) {
      const text = d.translation || d.definition;
      if (text) html += `<div style="margin-top:2px">• ${text}</div>`;
    }
    html += "</div>";
  }

  if (word.examples.length > 0) {
    const ex = word.examples[0];
    const text = ex.example || ex.translation;
    if (text) {
      html += `<div style="margin-top:4px;color:#666;font-style:italic;font-size:12px">"${text}"</div>`;
    }
  }

  return html;
}

function createTooltip(html: string, x: number, y: number): HTMLElement {
  removeTooltip();
  const el = document.createElement("div");
  el.id = TOOLTIP_ID;
  el.innerHTML = html;
  Object.assign(el.style, {
    position: "fixed",
    left: `${x}px`,
    top: `${y}px`,
    background: "#fff",
    color: "#111",
    border: "1px solid #ccc",
    borderRadius: "6px",
    padding: "8px 12px",
    fontSize: "13px",
    lineHeight: "1.4",
    maxWidth: "320px",
    zIndex: "2147483647",
    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
    fontFamily: "system-ui, -apple-system, sans-serif",
    pointerEvents: "none",
    transition: "opacity 0.15s",
  });
  document.body.appendChild(el);
  activeTooltip = el;

  const rect = el.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    el.style.left = `${window.innerWidth - rect.width - 8}px`;
  }
  if (rect.bottom > window.innerHeight) {
    el.style.top = `${y - rect.height - 12}px`;
  }

  return el;
}

function extractSelectedWord(): string | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return null;
  const text = selection.toString().trim();
  if (!text) return null;

  const word = text.split(/\s+/)[0].replace(/[^a-zA-ZÀ-ÿ'-]/g, "");
  if (!word || word.length < 2) return null;
  return word;
}

function getSelectionPosition(): { x: number; y: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.bottom + 6 };
}

async function handleSelection() {
  const word = extractSelectedWord();
  if (!word) return;

  const pos = getSelectionPosition();
  if (!pos) return;

  createTooltip("...", pos.x, pos.y);

  try {
    const response: LookupResponse = await chrome.runtime.sendMessage({
      type: "LOOKUP",
      word,
    });

    if (response.found && response.word) {
      createTooltip(formatTooltipHTML(response.word), pos.x, pos.y);
    } else {
      removeTooltip();
    }
  } catch {
    removeTooltip();
  }
}

document.addEventListener("mouseup", (e) => {
  if ((e.target as HTMLElement)?.id === TOOLTIP_ID) return;
  setTimeout(handleSelection, 10);
});

document.addEventListener("mousedown", (e) => {
  if ((e.target as HTMLElement)?.id === TOOLTIP_ID) return;
  removeTooltip();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") removeTooltip();
});
