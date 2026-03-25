import { getWord, saveHistory } from "../db";
import type { LookupResponse } from "../shared/types";

function formatDefinition(defs: { definition: string; translation?: string }[]): string {
  if (defs.length === 0) return "";
  return defs
    .map((d) => d.translation || d.definition)
    .filter(Boolean)
    .join("; ");
}

export async function lookupAndSave(raw: string): Promise<LookupResponse> {
  const word = raw.toLowerCase().trim();
  if (!word) return { found: false };

  const entry = getWord(word);
  if (!entry) return { found: false };

  const defText = formatDefinition(entry.definitions);
  if (defText) {
    await saveHistory(entry.word, defText);
  }

  return { found: true, word: entry, saved: true };
}
