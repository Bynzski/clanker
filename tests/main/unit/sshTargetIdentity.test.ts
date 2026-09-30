import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
import { execFile } from 'node:child_process';
import { resolveSshTargetIdentity } from '../../../src/main/remote/sshTargetIdentity';

function config(value: string) {
  vi.mocked(execFile).mockImplementation(((_cmd: string, _args: string[], _options: unknown, callback: (error: null, stdout: string, stderr: string) => void) => {
    callback(null, value, ''); return {};
  }) as typeof execFile);
}
beforeEach(() => vi.clearAllMocks());

describe('SSH resource identity', () => {
  it('shares protection across saved aliases with the same effective destination', async () => {
    config('host alias-a\nhostname Example.COM\nuser developer\nport 22\n');
    const a = await resolveSshTargetIdentity('alias-a');
    config('host alias-b\nhostname example.com\nuser developer\nport 22\n');
    expect(await resolveSshTargetIdentity('alias-b')).toBe(a);
    expect(execFile).toHaveBeenCalledWith('ssh', ['-G', '-o', 'PermitLocalCommand=no', 'alias-b'], expect.objectContaining({ timeout: 10000, maxBuffer: 131072 }), expect.any(Function));
  });
  it('keeps different destinations and proxy routes independent', async () => {
    config('hostname host\nuser developer\nport 22\n');
    const original = await resolveSshTargetIdentity('alias');
    for (const changed of ['hostname other\nuser developer\nport 22\n', 'hostname host\nuser developer\nport 2222\n',
      'hostname host\nuser developer\nport 22\nproxyjump bastion\n']) {
      config(changed);
      expect(await resolveSshTargetIdentity('alias')).not.toBe(original);
    }
  });
  it('rejects incomplete configuration and invalid targets instead of guessing', async () => {
    config('hostname host\n');
    await expect(resolveSshTargetIdentity('alias')).rejects.toThrow('Could not resolve');
    await expect(resolveSshTargetIdentity('-option')).rejects.toThrow('Invalid SSH target');
    expect(execFile).toHaveBeenCalledTimes(1);
  });
  it('scrubs desktop and remote attention credentials before reading SSH configuration', async () => {
    vi.stubEnv('CLANKER_ATTENTION_TOKEN', 'desktop');
    vi.stubEnv('CLANKER_REMOTE_ATTENTION_TOKEN', 'remote');
    try {
      config('hostname host\nuser developer\nport 22\n');
      await resolveSshTargetIdentity('alias');
      const options = vi.mocked(execFile).mock.calls[0][2] as { env: NodeJS.ProcessEnv };
      expect(options.env).not.toHaveProperty('CLANKER_ATTENTION_TOKEN');
      expect(options.env).not.toHaveProperty('CLANKER_REMOTE_ATTENTION_TOKEN');
    } finally { vi.unstubAllEnvs(); }
  });
});
