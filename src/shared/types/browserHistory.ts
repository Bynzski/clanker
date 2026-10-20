export interface BrowserHistoryEntry {
  url: string;
  title?: string;
  lastVisited: number;
}

/** Query-only site roots are derived from history, never recorded as visits. */
export interface BrowserHistorySuggestion extends BrowserHistoryEntry {
  source?: 'site';
}
