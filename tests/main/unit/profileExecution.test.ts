import { describe, it, expect, vi } from 'vitest';
import { createLocalProfileExecutor } from '../../../src/main/harnesses/profileExecution';

describe('profile probe execution', () => {
  it('uses the canonical bounded executor with an isolated base environment', async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: 'local', stderr: '', exitCode: 0 });
    const base = { PATH: '/bin', HERMES_HOME: '/native-root', Hermes_Config: '/wrong', HERMES_PROFILE: 'inherited' };
    const executor = createLocalProfileExecutor({ probeUnsetEnvironmentKeys: ['HERMES_CONFIG', 'HERMES_PROFILE'] }, execute, base, 'win32');
    const request = { command: 'hermes', args: ['-p', 'reviewer', 'config', 'path'], timeoutMs: 5000 };
    await executor.run(request);
    expect(execute).toHaveBeenCalledWith(request, undefined, { baseEnv: { PATH: '/bin', HERMES_HOME: '/native-root' } });
    expect(base.Hermes_Config).toBe('/wrong');
  });
});
