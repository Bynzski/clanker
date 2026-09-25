import type { Terminal } from '../store/workspaceTypes';

/** Human names are presentation only; terminal IDs remain the stable identity. */
export const AGENT_NAMES = [
  'Samson', 'Delilah', 'Jerry', 'Bobby', 'Phil', 'Mickey', 'Billy', 'Donna',
  'Bertha', 'Scarlet', 'Cassidy', 'Althea', 'Franklin', 'Casey', 'Rosemary',
  'Stella', 'Peggy', 'Jack', 'John', 'Magnolia',
] as const;

export function nameTerminal(terminal: Terminal, existing: Terminal[]): Terminal {
  if (terminal.displayName) return terminal;
  const used = new Set(existing.map((item) => item.displayName));
  for (let cycle = 1; ; cycle++) {
    for (const base of AGENT_NAMES) {
      const name = cycle === 1 ? base : `${base} ${cycle}`;
      if (!used.has(name)) return { ...terminal, displayName: name };
    }
  }
}

export function nameTerminals(terminals: Terminal[]): Terminal[] {
  const named: Terminal[] = terminals.filter((terminal) => Boolean(terminal.displayName));
  const result: Terminal[] = [];
  for (const terminal of terminals) {
    const next = nameTerminal(terminal, named);
    named.push(next);
    result.push(next);
  }
  return result;
}
