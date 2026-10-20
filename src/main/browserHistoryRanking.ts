import type { BrowserHistoryEntry, BrowserHistorySuggestion } from '../shared/types/browserHistory';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const stripWww = (host: string) => host.replace(/^www\./, '');

function decoded(value: string): string {
  try { return decodeURIComponent(value).toLowerCase(); } catch { return value.toLowerCase(); }
}

/** One insertion, deletion, substitution or adjacent transposition, on bounded words only. */
function fuzzyWord(query: string, word: string): boolean {
  if (query.length < 4 || query.length > 64 || word.length > 64 || Math.abs(query.length - word.length) > 1) return false;
  for (let index = 0; index < Math.max(query.length, word.length); index++) {
    if (query[index] === word[index]) continue;
    return query.slice(index + 1) === word.slice(index + 1)
      || query.slice(index) === word.slice(index + 1)
      || query.slice(index + 1) === word.slice(index)
      || (query[index] === word[index + 1] && query[index + 1] === word[index]
        && query.slice(index + 2) === word.slice(index + 2));
  }
  return true;
}

function rank(entry: BrowserHistoryEntry, query: string): number | null {
  const url = new URL(entry.url);
  const host = stripWww(url.hostname);
  const local = LOOPBACK_HOSTS.has(host);
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  const portQuery = /^\d{1,5}$/.test(query) && Number(query) > 0 && Number(query) <= 65535;
  if (portQuery && port === String(Number(query))) return local ? 0 : 1;
  const localQuery = /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\])(?::(\d+))?\/?$/.exec(query);
  if (localQuery && local && (!localQuery[1] || port === localQuery[1])) return 0;

  const hostQuery = query.replace(/^https?:\/\//, '').replace(/^www\./, '');
  const root = url.pathname === '/' && !url.search && !url.hash;
  const full = entry.url.toLowerCase();
  const hostAndPath = `${stripWww(url.host)}${decoded(url.pathname)}${decoded(url.search)}${decoded(url.hash)}`;
  if (full === query || hostAndPath === hostQuery) return 0;
  if (host === hostQuery || stripWww(url.host) === hostQuery) return root ? 1 : 2;
  if (host.startsWith(hostQuery)) return local ? 2 : root ? 3 : 4;
  if (hostAndPath.startsWith(hostQuery) || full.startsWith(query)) return 4;

  const title = (entry.title ?? '').toLowerCase();
  const text = `${host} ${decoded(url.pathname)} ${title}`;
  const words = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const tokens = query.split(/\s+/);
  if (tokens.every(token => words.some(word => word.startsWith(token)))) return 5;
  if (`${text} ${decoded(url.search)} ${decoded(url.hash)}`.includes(query)) return 6;
  if (tokens.length === 1 && host.split('.').some(word => fuzzyWord(query, word))) return root ? 7 : 8;
  if (tokens.every(token => words.some(word => fuzzyWord(token, word)))) return 9;
  return null;
}

/** Relevance precedes recency. Broad site searches can suggest a known site's home page. */
export function rankBrowserHistory(entries: BrowserHistoryEntry[], rawQuery: string, limit: number): BrowserHistorySuggestion[] {
  const query = rawQuery.trim().toLowerCase();
  const candidates = new Map<string, BrowserHistorySuggestion>(entries.map(entry => [entry.url, entry]));
  if (query) {
    const hostQuery = query.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
    for (const entry of entries) {
      const url = new URL(entry.url);
      // Never synthesize credentials, loopback endpoints or a root for a path-specific query.
      if (url.username || url.password || LOOPBACK_HOSTS.has(url.hostname)
        || !stripWww(url.hostname).startsWith(hostQuery)) continue;
      const rootUrl = `${url.origin}/`;
      if (!candidates.has(rootUrl)) {
        candidates.set(rootUrl, { url: rootUrl, title: url.hostname, lastVisited: entry.lastVisited, source: 'site' });
      }
    }
  }
  return [...candidates.values()]
    .map(entry => ({ entry, rank: query ? rank(entry, query) : 0 }))
    .filter((candidate): candidate is { entry: BrowserHistorySuggestion; rank: number } => candidate.rank !== null)
    .sort((a, b) => a.rank - b.rank || b.entry.lastVisited - a.entry.lastVisited || a.entry.url.localeCompare(b.entry.url))
    .slice(0, limit)
    .map(candidate => candidate.entry);
}
