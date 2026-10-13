import { createSwitchReadMetrics } from '../shared/switchReadMetrics';

const metrics = createSwitchReadMetrics();
export const switchReadSnapshot = metrics.snapshot;
/** Dev-only backend operation counts (not shell-command counts). Fixed labels, no paths/content. */
export async function measureSwitchRead<T>(label: 'git-status' | 'ssh-list' | 'ssh-read' | 'ssh-snapshot', read: () => Promise<T>): Promise<T> {
  if (process.env.NODE_ENV !== 'development' || process.env.CLANKER_SWITCH_DEBUG !== '1') return read();
  const finish = metrics.begin(label);
  try { return await read(); }
  finally {
    finish();
    console.debug('[workspace-reads]', switchReadSnapshot());
  }
}
