import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildHarnessSpawnArgs } from '../../../src/main/harnessLaunch';
import { getHarnessProvider } from '../../../src/main/harnesses/registry';
import { buildSessionCommand } from '../../../src/main/sessionLaunch';
import { openCodeMajorVersion } from '../../../src/main/harnesses/opencode/version';
import type { HarnessSession } from '../../../src/shared/types/session';

vi.mock('../../../src/main/harnesses/opencode/version', () => ({ openCodeMajorVersion: vi.fn(() => 2) }));
const provider = getHarnessProvider('opencode');
const session = { id: 'ses_original', harness: 'opencode' } as HarnessSession;
const config = { ...provider.launch, name: 'OpenCode', icon: '' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(openCodeMajorVersion).mockReturnValue(2);
});

describe('local OpenCode 2.x unsupported CLI operations', () => {
  it('rejects an explicit model rather than dropping it or spawning an invalid TUI flag', () => {
    expect(() => buildHarnessSpawnArgs(config, 'provider/model', undefined, provider.launch.modelArgs)).toThrow('/models');
    expect(buildHarnessSpawnArgs(config, undefined, '--standalone', provider.launch.modelArgs)).toEqual(['--standalone']);
  });

  it('rejects fork without degrading it to resume; ordinary resume preserves identity', () => {
    expect(() => buildSessionCommand(session, { operation: 'fork', transport: 'local' })).toThrow('has not resumed');
    expect(buildSessionCommand(session, { operation: 'resume', transport: 'local' })).toEqual({ command: 'opencode', args: ['--session', session.id] });
  });

  it('guards commit execution without probing during catalog/invocation projections', () => {
    const capability = provider.aiCommit;
    expect(() => capability.buildInvocation({ prompt: '' })).not.toThrow();
    expect(openCodeMajorVersion).not.toHaveBeenCalled();
    expect(() => capability.validateLocal()).toThrow('equivalent isolation');
  });

  it('does not use the desktop version to decide SSH capabilities', () => {
    expect(buildHarnessSpawnArgs(config, 'provider/model', undefined, provider.launch.modelArgs, 'ssh')).toEqual(['-m', 'provider/model']);
    expect(buildSessionCommand(session, { operation: 'fork', transport: 'ssh' }).args).toEqual(['--session', session.id, '--fork']);
    expect(openCodeMajorVersion).not.toHaveBeenCalled();
  });

  it.each([1, null])('preserves legacy behavior for major %s', (major) => {
    vi.mocked(openCodeMajorVersion).mockReturnValue(major);
    expect(buildHarnessSpawnArgs(config, 'provider/model', undefined, provider.launch.modelArgs)).toEqual(['-m', 'provider/model']);
    expect(buildSessionCommand(session, { operation: 'fork', transport: 'local' }).args).toEqual(['--session', session.id, '--fork']);
    expect(() => provider.aiCommit.validateLocal()).not.toThrow();
    expect(provider.aiCommit.buildInvocation({ model: 'provider/model', prompt: 'prompt' })).toMatchObject({ args: ['run', '--pure', '--format', 'json', '-m', 'provider/model'], env: { OPENCODE_PERMISSION: '{"*":"deny"}' } });
  });
});
