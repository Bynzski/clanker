import { describe, expect, it } from 'vitest';
import { assertSessionSelectionFlags } from '../../../src/main/sessionLaunch';
import { getHarnessProvider } from '../../../src/main/harnesses/registry';
import type { HarnessSession } from '../../../src/shared/types/session';

const harnesses: HarnessSession['harness'][] = ['claude', 'codex', 'opencode', 'pi', 'omp', 'agy'];
describe.each(harnesses)('%s native selection flags', (harness) => {
  it.each(['local', 'ssh'] as const)('rejects declared exact/equal/attached overrides on %s', (transport) => {
    for (const flag of getHarnessProvider(harness).sessions!.selectionFlags!) {
      for (const token of [flag, `${flag}=foreign`, ...(flag.length === 2 ? [`${flag}foreign`] : [])]) {
        expect(() => assertSessionSelectionFlags(harness, `--unrelated ${token}`, transport)).toThrow(
          `Harness default flags conflict with ${transport === 'ssh' ? 'remote' : 'local'} session selection`,
        );
      }
    }
  });
  it('keeps non-selection options and empty flags usable', () => {
    for (const flags of [undefined, '', '  ', '--unrelated=value', '--session-dir=/native/store']) {
      expect(() => assertSessionSelectionFlags(harness, flags, 'local')).not.toThrow();
    }
  });
});
