import type { Terminal } from '../store/workspaceTypes';

/** Human names are presentation only; terminal IDs remain the stable identity. */
export const AGENT_NAMES = [
  'Samson', 'Delilah', 'Jerry', 'Bobby', 'Phil', 'Mickey', 'Billy', 'Donna',
  'Bertha', 'Scarlet', 'Cassidy', 'Althea', 'Franklin', 'Casey', 'Rosemary',
  'Stella', 'Peggy', 'Jack', 'John', 'Magnolia', 'Sugaree', 'Ripple', 'Dupree',
  'Terrapin', 'Cumberland', 'Candyman', 'Loser', 'Wolf', 'Ramble', 'Brokedown',
  'Pigpen', 'Keith', 'Brent', 'Vince', 'Bruce', 'Tom', 'Hornsby', 'Weir',
  'Garcia', 'Lesh', 'Kreutzmann', 'Hart', 'Lazarus', 'Dandelion', 'Fennario',
  'Tennessee', 'Jed', 'Eleven', 'Alligator', 'Caution', 'Dozin', 'Hester',
  'Lindy', 'Marmaduke', 'Estimated', 'Songbird', 'Sunshine', 'Daydream',
  'Mississippi', 'Rubin', 'Cosmic', 'Truckin', 'Shakedown', 'Friend', 'Mama',
  'Tiger', 'Crazy', 'Uncle', 'Peggy-O', 'Iko', 'Odessa', 'Deal', 'Jackstraw',
  'Easy', 'Wharf', 'Eyes', 'Stagger', 'Lee', 'Minglewood', 'Bird', 'Darling',
] as const;

/** How many of the most recent assignments later picks try to avoid, so names disperse across workspaces. */
export const RECENT_NAME_LIMIT = 12;

/** Assignment history shared by every workspace in this renderer; per-session only, never persisted. */
const sessionRecentNames: string[] = [];

export function resetRecentAgentNames(): void {
  sessionRecentNames.length = 0;
}

/**
 * Pure selection: a random base name not used in this workspace and not recently assigned elsewhere.
 * Falls back to recently used names before repeating, and adds a numeric suffix only once every
 * base name is taken. `random` must return a value in [0, 1).
 */
export function pickAgentName(used: ReadonlySet<string | undefined>, recent: readonly string[], random: () => number): string {
  for (let cycle = 1; ; cycle++) {
    const candidates = AGENT_NAMES
      .map((base) => (cycle === 1 ? base : `${base} ${cycle}`))
      .filter((name) => !used.has(name));
    if (candidates.length === 0) continue;
    const fresh = candidates.filter((name) => !recent.includes(name));
    const pool = fresh.length > 0 ? fresh : candidates;
    return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
  }
}

/**
 * Names are unique within one workspace's terminals and never change once assigned. `random` and
 * `recent` are injectable for tests; by default the session-wide history is used and updated.
 */
export function nameTerminal(
  terminal: Terminal,
  existing: Terminal[],
  random: () => number = Math.random,
  recent: string[] = sessionRecentNames,
): Terminal {
  if (terminal.displayName) return terminal;
  const name = pickAgentName(new Set(existing.map((item) => item.displayName)), recent, random);
  recent.push(name);
  if (recent.length > RECENT_NAME_LIMIT) recent.shift();
  return { ...terminal, displayName: name };
}

export function nameTerminals(
  terminals: Terminal[],
  random: () => number = Math.random,
  recent: string[] = sessionRecentNames,
): Terminal[] {
  const named: Terminal[] = terminals.filter((terminal) => Boolean(terminal.displayName));
  const result: Terminal[] = [];
  for (const terminal of terminals) {
    const next = nameTerminal(terminal, named, random, recent);
    named.push(next);
    result.push(next);
  }
  return result;
}
