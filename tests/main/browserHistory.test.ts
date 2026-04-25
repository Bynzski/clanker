import { describe, expect, it, beforeEach } from 'vitest';
import { BrowserHistoryService, MAX_HISTORY_ENTRIES, MAX_QUERY_RESULTS } from '../../src/main/browserHistory';
import type { BrowserHistoryEntry } from '../../src/shared/types/browserHistory';

class MemoryHistoryStore {
  entries: BrowserHistoryEntry[] = [];

  get(key: 'entries') {
    return this[key];
  }

  set(key: 'entries', value: BrowserHistoryEntry[]) {
    this[key] = value;
  }
}

describe('BrowserHistoryService', () => {
  let store: MemoryHistoryStore;
  let service: BrowserHistoryService;

  beforeEach(() => {
    store = new MemoryHistoryStore();
    service = new BrowserHistoryService(store);
  });

  it.each([
    'file:///etc/passwd',
    'data:text/html,<h1>x</h1>',
    'javascript:alert(1)',
    'about:blank',
    'about:config',
    '',
  ])('rejects non-http(s) URL %s', (url) => {
    expect(service.add(url, 'bad')).toBe(false);
    expect(service.query()).toEqual([]);
  });

  it('stores normalized HTTP(S) URLs', () => {
    expect(service.add('https://github.com', 'GitHub', 100)).toBe(true);

    expect(service.query()).toEqual([
      { url: 'https://github.com/', title: 'GitHub', lastVisited: 100 },
    ]);
  });

  it('dedupes by URL and moves the latest visit to the front', () => {
    service.add('https://github.com', 'Old', 100);
    service.add('https://example.com', 'Example', 200);
    service.add('https://github.com/', 'New', 300);

    expect(service.query()).toEqual([
      { url: 'https://github.com/', title: 'New', lastVisited: 300 },
      { url: 'https://example.com/', title: 'Example', lastVisited: 200 },
    ]);
  });

  it('caps stored history at 100 entries', () => {
    for (let i = 0; i < MAX_HISTORY_ENTRIES + 5; i += 1) {
      service.add(`https://example.com/${i}`, undefined, i);
    }

    expect(store.entries).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(store.entries[0].url).toBe('https://example.com/104');
    expect(store.entries[store.entries.length - 1]?.url).toBe('https://example.com/5');
  });

  it('caps query results at 8 entries', () => {
    for (let i = 0; i < MAX_QUERY_RESULTS + 3; i += 1) {
      service.add(`https://github.com/${i}`, undefined, i);
    }

    expect(service.query('github.com')).toHaveLength(MAX_QUERY_RESULTS);
  });

  it.each([
    ['git', 'https://github.com/clanker-grid'],
    ['github.com', 'https://github.com/clanker-grid'],
    ['https://github', 'https://github.com/clanker-grid'],
    ['localhost', 'http://localhost:3000/app'],
    ['github.com/clanker-grid', 'https://github.com/clanker-grid'],
    ['example.com/docs', 'https://www.example.com/docs/page'],
  ])('matches prefix %s against URL/hostname forms', (prefix, url) => {
    service.add(url, 'match', 100);

    expect(service.query(prefix)[0]?.url).toBe(new URL(url).toString());
  });

  it('clears history', () => {
    service.add('https://github.com', 'GitHub', 100);

    expect(service.clear()).toBe(true);
    expect(service.query()).toEqual([]);
  });
});
