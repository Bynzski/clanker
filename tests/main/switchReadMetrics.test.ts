import { afterEach, describe, expect, it, vi } from 'vitest';
import { measureSwitchRead, switchReadSnapshot } from '../../src/main/workspaceSwitchMetrics';
import { createSwitchReadMetrics } from '../../src/shared/switchReadMetrics';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('switch operation counters', () => {
  it('does not collect in production; releases rejected development reads without retaining their payloads', async () => {
    const log = vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.stubEnv('CLANKER_SWITCH_DEBUG', '1'); vi.stubEnv('NODE_ENV', 'production');
    const before = switchReadSnapshot();
    expect(await measureSwitchRead('git-status', async () => 'private content')).toBe('private content');
    expect(switchReadSnapshot()).toEqual(before); expect(log).not.toHaveBeenCalled();
    vi.stubEnv('NODE_ENV', 'development');
    await expect(measureSwitchRead('ssh-read', async () => { throw new Error('private error'); })).rejects.toThrow('private error');
    expect(switchReadSnapshot()).toMatchObject({ active: 0, counts: { 'ssh-read': 1 } });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private');
  });
  it('counts starts, tracks overlapping operations, and resets interval peaks without losing in-flight work', () => {
    const metrics = createSwitchReadMetrics();
    const a = metrics.begin('git-status'); const b = metrics.begin('ssh-list');
    expect(metrics.snapshot(true)).toEqual({ counts: { 'git-status': 1, 'ssh-list': 1 }, active: 2, peak: 2 });
    a(); a(); b();
    expect(metrics.snapshot(true).active).toBe(0);
    const c = metrics.begin('ssh-read'); c();
    expect(metrics.snapshot()).toMatchObject({ active: 0, peak: 1 });
  });
});
