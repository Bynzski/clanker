import Store from 'electron-store';
import { normalizeAppBrowserUrl } from './security';
import type { BrowserHistoryEntry } from '../shared/types/browserHistory';

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

function stripWww(hostname: string): string {
  return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
}

function createSearchKeys(url: string): string[] {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const hostAndPath = `${hostname}${parsed.pathname === '/' ? '' : parsed.pathname}`.toLowerCase();
    const strippedHostname = stripWww(hostname);
    const strippedHostAndPath = stripWww(hostAndPath);

    return Array.from(new Set([
      url.toLowerCase(),
      hostname,
      hostAndPath,
      strippedHostname,
      strippedHostAndPath,
    ]));
  } catch {
    return [url.toLowerCase()];
  }
}

function normalizeQuery(prefix?: string): string {
  return (prefix ?? '').trim().toLowerCase();
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

  query(prefix?: string): BrowserHistoryEntry[] {
    const query = normalizeQuery(prefix);
    const entries = this.getAll();
    if (!query) {
      return entries.slice(0, MAX_QUERY_RESULTS);
    }

    return entries
      .filter((entry) => createSearchKeys(entry.url).some((key) => key.startsWith(query)))
      .slice(0, MAX_QUERY_RESULTS);
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

export { MAX_HISTORY_ENTRIES, MAX_QUERY_RESULTS, normalizeHistoryUrl, createSearchKeys };
