import { describe, expect, it } from 'vitest';
import { withoutAttentionEnvironment } from '../../../src/main/environment/attentionEnvironment';

describe('provider-independent attention environment', () => {
  it('strips local and remote credentials case-insensitively without mutating input', () => {
    const input = {
      CLANKER_ATTENTION_TOKEN: 'local-secret',
      clanker_attention_endpoint: 'endpoint',
      ClAnKeR_ReMoTe_AtTeNtIoN_TOKEN: 'remote-secret',
      PATH: '/bin',
      CLANKER_GRID_FALLBACK_SHELL: '/bin/bash',
      UNSET: undefined,
    };
    expect(withoutAttentionEnvironment(input)).toEqual({ PATH: '/bin', CLANKER_GRID_FALLBACK_SHELL: '/bin/bash' });
    expect(input.CLANKER_ATTENTION_TOKEN).toBe('local-secret');
    expect(input.ClAnKeR_ReMoTe_AtTeNtIoN_TOKEN).toBe('remote-secret');
  });

  it('preserves unrelated names and empty string values', () => {
    expect(withoutAttentionEnvironment({ CLANKER_ATTENTION: '', OTHER_CLANKER_ATTENTION_TOKEN: 'kept' }))
      .toEqual({ CLANKER_ATTENTION: '', OTHER_CLANKER_ATTENTION_TOKEN: 'kept' });
  });
});
