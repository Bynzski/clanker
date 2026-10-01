import { beforeEach, expect, it, vi } from 'vitest';
import { getHarnessProviders } from '../../../src/main/harnesses/registry';
import { clearSessionCache, discoverSessionsDetailed } from '../../../src/main/sessionHistory';
import { HarnessCapabilityError } from '../../../src/main/harnesses/types';

beforeEach(() => clearSessionCache());
it('aggregates registered discovery capabilities and retains independent failures', async () => {
  const providers = getHarnessProviders().filter((provider) => provider.sessions);
  for (const [index, provider] of providers.entries()) {
    vi.spyOn(provider.sessions!, 'discover').mockResolvedValue([{
      harness: provider.descriptor.id, id: 'fixture', title: provider.descriptor.name,
      cwd: '/workspace', timestamp: index,
    }]);
  }
  const failing = providers.find((provider) => provider.descriptor.id === 'agy')!;
  const error = new HarnessCapabilityError('storage-changed', 'database schema changed');
  vi.mocked(failing.sessions!.discover).mockRejectedValueOnce(error);
  const result = await discoverSessionsDetailed('/workspace');
  expect(result.sessions).toHaveLength(providers.length - 1);
  expect(result.sessions.map((session) => session.timestamp)).toEqual([4, 3, 2, 1, 0]);
  expect(result.harnessStatus.agy).toEqual({ status: 'error', error: error.message, failure: error });
  expect(result.harnessStatus.hermes).toBeUndefined();
  for (const provider of providers) expect(provider.sessions!.discover).toHaveBeenCalledWith(process.platform === 'win32' ? '\\workspace' : '/workspace');
  // Partial failures must not be cached as a complete empty/successful scan.
  await discoverSessionsDetailed('/workspace');
  for (const provider of providers) expect(provider.sessions!.discover).toHaveBeenCalledTimes(2);
});

it('preserves historical aggregation order for equal timestamps', async () => {
  for (const provider of getHarnessProviders().filter((entry) => entry.sessions)) {
    vi.spyOn(provider.sessions!, 'discover').mockResolvedValue([{
      harness: provider.descriptor.id, id: 'fixture', title: 'title', cwd: '/workspace', timestamp: 1,
    }]);
  }
  expect((await discoverSessionsDetailed('/workspace')).sessions.map((session) => session.harness))
    .toEqual(['opencode', 'codex', 'pi', 'omp', 'claude', 'agy']);
});
