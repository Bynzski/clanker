import { describe, expect, it } from 'vitest';
import { KNOWN_HARNESS_IDS } from '../../../src/shared/harnessIds';
import { findHarnessProvider, getHarnessProvider, getHarnessProviders, isHarnessId } from '../../../src/main/harnesses/registry';

describe('canonical harness registry', () => {
  it('registers every ID exactly once with stable identity', () => {
    const providers = getHarnessProviders();
    expect(providers.map((provider) => provider.descriptor.id)).toEqual(KNOWN_HARNESS_IDS);
    expect(new Set(providers).size).toBe(KNOWN_HARNESS_IDS.length);
    for (const id of KNOWN_HARNESS_IDS) expect(getHarnessProvider(id)).toBe(getHarnessProvider(id));
  });
  it('rejects raw unknown IDs including inherited object keys', () => {
    for (const value of ['unknown', 'constructor', '__proto__', '', null, 60]) {
      expect(isHarnessId(value)).toBe(false);
      expect(findHarnessProvider(value)).toBeUndefined();
    }
    // @ts-expect-error Lookup requires a validated HarnessId.
    expect(() => getHarnessProvider('unknown')).toThrow('Unknown harness');
  });
});
