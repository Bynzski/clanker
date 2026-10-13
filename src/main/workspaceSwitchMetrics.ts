import { createSwitchReadMetrics } from '../shared/switchReadMetrics';

const metrics = createSwitchReadMetrics();
export const switchReadSnapshot = metrics.snapshot;
/** Fixed discovery-policy counters; does not count a shared caller as physical I/O. */
export function recordSwitchRefresh(label: 'session-shared' | 'session-successor' | 'session-cache-hit' | 'session-cache-miss'): void {
  if (process.env.NODE_ENV === 'development' && process.env.CLANKER_SWITCH_DEBUG === '1') metrics.record(label);
}
/** Dev-only backend operation counts (not shell-command counts). Fixed labels, no paths/content. */
export async function measureSwitchRead<T>(label: 'git-status' | 'ssh-list' | 'ssh-read' | 'ssh-snapshot' | 'session-discovery' | 'session-provider' | 'session-local-scan', read: () => Promise<T>): Promise<T> {
  if (process.env.NODE_ENV !== 'development' || process.env.CLANKER_SWITCH_DEBUG !== '1') return read();
  const finish = metrics.begin(label);
  try { return await read(); }
  finally {
    finish();
    console.debug('[workspace-reads]', switchReadSnapshot());
  }
}
