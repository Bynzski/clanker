import Store from 'electron-store';
import { normalizeAppBrowserUrl } from './security';
import { rankBrowserHistory } from './browserHistoryRanking';
import type { BrowserHistoryEntry, BrowserHistorySuggestion } from '../shared/types/browserHistory';

export type { BrowserHistoryEntry } from '../shared/types/browserHistory';

interface BrowserHistorySchema {
  entries: BrowserHistoryEntry[];
}

interface BrowserHistoryStore {
  get<Key extends keyof BrowserHistorySchema>(key: Key): BrowserHistorySchema[Key] | undefined;
  set<Key extends keyof BrowserHistorySchema>(key: Key, value: BrowserHistorySchema[Key]): void;
}

const MAX_HISTORY_ENTRIES = 100;
const MAX_QUERY_RESULTS = 8;

function sanitizeTitle(title?: string): string | undefined {
  const trimmed = typeof title === 'string' ? title.trim() : '';
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeHistoryUrl(url: string): string | null {
  return normalizeAppBrowserUrl(url);
}

export class BrowserHistoryService {
  private readonly store: BrowserHistoryStore;

  constructor(store?: BrowserHistoryStore) {
    this.store = store ?? new Store<BrowserHistorySchema>({
      name: 'browser-navigation-history',
      defaults: { entries: [] },
    });
  }

  add(url: string, title?: string, now = Date.now()): boolean {
    const safeUrl = normalizeHistoryUrl(url);
    if (!safeUrl) {
      return false;
    }

    const cleanTitle = sanitizeTitle(title);
    const existingEntries = this.getAll();
    const nextEntry: BrowserHistoryEntry = {
      url: safeUrl,
      ...(cleanTitle ? { title: cleanTitle } : {}),
      lastVisited: now,
    };

    const deduped = existingEntries.filter((entry) => entry.url !== safeUrl);
    this.store.set('entries', [nextEntry, ...deduped].slice(0, MAX_HISTORY_ENTRIES));
    return true;
  }

  query(query?: string): BrowserHistorySuggestion[] {
    return rankBrowserHistory(this.getAll(), query ?? '', MAX_QUERY_RESULTS);
  }

  /** A document title change is metadata, not a new visit. */
  updateTitle(url: string, title: string): boolean {
    const safeUrl = normalizeHistoryUrl(url);
    const cleanTitle = sanitizeTitle(title);
    const entries = this.getAll();
    if (!safeUrl || !cleanTitle || !entries.some(entry => entry.url === safeUrl)) return false;
    this.store.set('entries', entries.map(entry => entry.url === safeUrl ? { ...entry, title: cleanTitle } : entry));
    return true;
  }

  clear(): boolean {
    this.store.set('entries', []);
    return true;
  }

  getAll(): BrowserHistoryEntry[] {
    const entries = this.store.get('entries');
    if (!Array.isArray(entries)) {
      return [];
    }

    return entries.filter((entry): entry is BrowserHistoryEntry => (
      entry != null
      && typeof entry === 'object'
      && typeof entry.url === 'string'
      && typeof entry.lastVisited === 'number'
      && Number.isFinite(entry.lastVisited)
      && (entry.title === undefined || typeof entry.title === 'string')
      && normalizeHistoryUrl(entry.url) === entry.url
    ));
  }
}

let defaultHistoryService: BrowserHistoryService | null = null;

export function getBrowserHistoryService(): BrowserHistoryService {
  defaultHistoryService ??= new BrowserHistoryService();
  return defaultHistoryService;
}

export function __resetBrowserHistoryServiceForTests(service: BrowserHistoryService | null = null): void {
  defaultHistoryService = service;
}

export { MAX_HISTORY_ENTRIES, MAX_QUERY_RESULTS, normalizeHistoryUrl };
