export interface Word {
  id: number;
  word: string;
  pos: string | null;
  gender: string | null;
  definitions: Definition[];
  examples: Example[];
}

export interface Definition {
  definition: string;
  translation?: string;
}

export interface Example {
  example: string;
  translation?: string;
}

export interface SimilarWord {
  id: number;
  word: string;
}

export interface HistoryItem {
  id: string;
  word: string;
  normalizedWord: string;
  definition: string;
  lookupCount: number;
  lastLookedUpAt: number;
  createdAt: number;
  pos?: string | null;
  gender?: string | null;
  mastery?: number;
  nextReviewAt?: number | null;
  reviewCount?: number;
  lastReviewedAt?: number | null;
  easeFactor?: number;
}

export interface ExportData {
  version: 1;
  exportedAt: string;
  source: "dicfr-extension" | "dicfr-app";
  words: ExportWord[];
}

export interface ExportWord {
  word: string;
  normalizedWord: string;
  definition: string;
  pos?: string | null;
  gender?: string | null;
  lookupCount: number;
  firstLookupAt: string;
  lastLookupAt: string;
  mastery: number;
  nextReviewAt: string | null;
  reviewCount: number;
  lastReviewedAt: string | null;
  easeFactor: number;
}

export type DownloadStatus =
  | "idle"
  | "downloading"
  | "processing"
  | "error"
  | "complete";

export type DownloadState = {
  status: DownloadStatus;
  progress: number;
  error?: string;
  bytesLoaded?: number;
};

export type Message =
  | { type: "LOOKUP"; word: string }
  | { type: "GET_HISTORY" }
  | { type: "DELETE_HISTORY"; id: string }
  | { type: "GET_STATS" }
  | { type: "GET_SIMILAR"; word: string }
  | { type: "START_DOWNLOAD" }
  | { type: "GET_DOWNLOAD_STATUS" }
  | { type: "EXPORT_HISTORY" }
  | { type: "IMPORT_HISTORY"; data: ExportData };

export type LookupResponse = {
  found: boolean;
  word?: Word;
  saved?: boolean;
};

export type HistoryResponse = {
  items: HistoryItem[];
};

export type StatsResponse = {
  dictSize: number;
  historyCount: number;
  dbReady: boolean;
};

export type DeleteResponse = {
  success: boolean;
};

export type SimilarResponse = {
  words: SimilarWord[];
};
