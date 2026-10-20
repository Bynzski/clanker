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

    expect(service.query(prefix).map(entry => entry.url)).toContain(new URL(url).toString());
  });

  it('ranks recent loopback services above pages merely mentioning localhost', () => {
    service.add('http://localhost:3000/app', 'Older app', 100);
    service.add('http://[::1]:8000/', 'Latest app', 300);
    service.add('http://127.0.0.1:5173/', 'Other app', 200);
    service.add('https://example.com/localhost', 'localhost setup', 400);
    expect(service.query('localhost').slice(0, 3).map(entry => entry.url)).toEqual([
      'http://[::1]:8000/', 'http://127.0.0.1:5173/', 'http://localhost:3000/app',
    ]);
  });

  it('treats a number as a port, with exact local ports ahead of URL/title numbers', () => {
    service.add('http://localhost:8000/app', 'Local', 100);
    service.add('http://127.0.0.1:8000/', 'Latest local', 200);
    service.add('https://example.com:8000/', 'Remote port', 300);
    service.add('http://localhost:18000/', 'Wrong port', 400);
    service.add('https://example.com/posts/8000', '8000 tips', 500);
    expect(service.query('8000').slice(0, 3).map(entry => entry.url)).toEqual([
      'http://127.0.0.1:8000/', 'http://localhost:8000/app', 'https://example.com:8000/',
    ]);
    expect(service.query('localhost:8000').map(entry => entry.url)).toEqual([
      'http://127.0.0.1:8000/', 'http://localhost:8000/app',
    ]);
  });

  it('suggests a site homepage before newer conversation URLs, without storing a fabricated visit', () => {
    service.add('https://chatgpt.com/c/abc-123#messages', 'Old chat', 100);
    service.add('https://chatgpt.com/c/new-456', 'Latest chat', 300);
    service.add('https://example.com/chat', 'chat', 400);
    const results = service.query('chat');
    expect(results[0]).toEqual({ url: 'https://chatgpt.com/', title: 'chatgpt.com', lastVisited: 300, source: 'site' });
    expect(results[1].url).toBe('https://chatgpt.com/c/new-456');
    expect(service.getAll()).toHaveLength(3);
    expect(service.query()).toHaveLength(3);
  });

  it('keeps the real home page title and respects path-specific intent', () => {
    service.add('https://chatgpt.com/', 'ChatGPT', 100);
    service.add('https://chatgpt.com/c/abc', 'Conversation', 200);
    expect(service.query('chat')[0].title).toBe('ChatGPT');
    expect(service.query('chatgpt.com/c/abc').map(entry => entry.url)).toEqual(['https://chatgpt.com/c/abc']);
  });

  it('ranks hostname intent ahead of title/substring/fuzzy matches and uses recency within tiers', () => {
    service.add('https://react.dev/', 'React', 100);
    service.add('https://example.com/guide', 'React guide', 200);
    service.add('https://other.example/tutorial', 'React tutorial', 300);
    service.add('https://last.example/reactive', 'Reactive', 400);
    expect(service.query('react').slice(0, 3).map(entry => entry.url)).toEqual([
      'https://react.dev/', 'https://last.example/reactive', 'https://other.example/tutorial',
    ]);
    expect(service.query('react guide')[0].url).toBe('https://example.com/guide');
    expect(service.query('raect')[0].url).toBe('https://react.dev/');
    expect(service.query('xyz')).toEqual([]);
  });

  it('sorts empty queries by visit timestamp and ignores corrupt persisted metadata', () => {
    store.entries = [
      { url: 'https://older.example/', lastVisited: 1 },
      { url: 'https://newer.example/', lastVisited: 2 },
      { url: 'https://invalid.example/', lastVisited: NaN },
    ];
    expect(service.query().map(entry => entry.url)).toEqual(['https://newer.example/', 'https://older.example/']);
  });

  it('updates titles without changing visit time or replacing useful metadata with an empty title', () => {
    service.add('https://example.com/article', 'Old title', 100);
    service.add('https://other.example/', 'Other', 200);
    expect(service.updateTitle('https://example.com/article', 'New searchable title')).toBe(true);
    expect(service.updateTitle('https://example.com/article', ' ')).toBe(false);
    expect(service.query('searchable')[0]).toMatchObject({ title: 'New searchable title', lastVisited: 100 });
    expect(service.query()[0].url).toBe('https://other.example/');
    expect(service.updateTitle('https://unknown.example/', 'Unknown')).toBe(false);
    expect(service.updateTitle('file:///tmp/report.html', 'Local')).toBe(false);
    expect(service.getAll()).toHaveLength(2);
  });

  it('does not synthesize site roots for local, credential-bearing or path-specific URLs', () => {
    service.add('http://localhost:8000/app', 'App', 100);
    service.add('https://user:password@example.com/private', 'Private', 200);
    service.add('https://example.org/docs/topic', 'Topic', 300);
    for (const query of ['localhost', 'example.com', 'example.org/docs']) {
      expect(service.query(query).some(entry => entry.source === 'site')).toBe(false);
    }
  });

  it('clears history', () => {
    service.add('https://github.com', 'GitHub', 100);

    expect(service.clear()).toBe(true);
    expect(service.query()).toEqual([]);
  });
});
