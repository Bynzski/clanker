import type { AgentLocation } from '../shared/types/agentAttention';
import type { TerminalUsage } from './checkoutContextRelease';

/** Enrich only the live terminal table, never historical broker snapshots or renderer claims.
 * Kept separate from terminal records: an observation never mutates a launch binding/directory. */
export function checkoutTerminalUsages<T extends TerminalUsage>(
  terminals: ReadonlyMap<string, T>, locationOf: (id: string) => AgentLocation | null,
): Array<[string, T & TerminalUsage]> {
  return [...terminals].map(([id, terminal]) => {
    const location = locationOf(id);
    return [id, { ...terminal, ...(location ? { observedLocation: { ...location } } : {}) }];
  });
}

/** Local destructive Git checks consume both recorded and observed paths, never an SSH client's
 * desktop cwd. Unknown recorded directories remain unknown regardless of the observation. */
export function localCheckoutUsagePaths(usages: Iterable<TerminalUsage>): string[] | null {
  const local = [...usages].filter((usage) => !usage.environmentId || usage.environmentId === 'local');
  if (local.some((usage) => !usage.cwd)) return null;
  return local.flatMap((usage) => [usage.cwd, usage.observedLocation?.path].filter((value): value is string => !!value));
}
