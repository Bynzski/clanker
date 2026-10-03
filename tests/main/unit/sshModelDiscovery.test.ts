import { describe, expect, it, vi } from 'vitest';
import { SshEnvironment } from '../../../src/main/remote/sshEnvironment';
import { SshExecutionError, type SshCommandExecutor } from '../../../src/main/remote/sshCommandExecutor';
import { getHarnessProviders } from '../../../src/main/harnesses/registry';
import type { HarnessCommandExecutor } from '../../../src/main/harnesses/commandExecution';

const OUTPUTS: Record<string, string> = {
  codex: JSON.stringify({ models: [{ slug: 'gpt-x', display_name: 'GPT X', visibility: 'list' }, { slug: 'hidden', visibility: 'hide' }] }),
  opencode: 'anthropic/claude-x\nopenai/gpt-y\n',
  pi: 'provider  model\nanthropic  claude-pi\n',
  omp: JSON.stringify({ models: [{ kind: 'chat', selector: 'omp/one' }] }),
  agy: 'Fetching available models\nagy-model  Agy Model\n',
};
const COMMANDS: Record<string, string> = {
  codex: "exec 'codex' 'debug' 'models'", opencode: "exec 'opencode' 'models'", pi: "exec 'pi' '--list-models'",
  omp: "exec 'omp' 'models' '--json'", agy: "exec 'agy' 'models'",
};

function setup(exec: ReturnType<typeof vi.fn>) {
  return new SshEnvironment({ kind: 'ssh', id: 'ssh-1', label: 'r', target: 'me@remote' }, { exec } as unknown as SshCommandExecutor);
}

describe('remote model discovery', () => {
  for (const harness of Object.keys(OUTPUTS)) {
    it(`discovers ${harness} models through the bound SSH executor`, async () => {
      const exec = vi.fn().mockResolvedValue({ stdout: OUTPUTS[harness], stderr: '', exitCode: 0 });
      const models = await setup(exec).discoverHarnessModels(harness);
      expect(models.length).toBeGreaterThan(0);
      expect(exec).toHaveBeenCalledTimes(1);
      expect(exec.mock.calls[0][0]).toBe('me@remote');
      expect(exec.mock.calls[0][2].at(-1)).toContain(COMMANDS[harness]);
    });
  }

  it('applies provider parsing (codex hides unlisted models)', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: OUTPUTS.codex, stderr: '', exitCode: 0 });
    expect(await setup(exec).discoverHarnessModels('codex')).toEqual([{ id: 'gpt-x', label: 'GPT X' }]);
  });

  it('hands providers only a transport-neutral executor, never an SSH target', async () => {
    const seen: unknown[] = [];
    for (const provider of getHarnessProviders()) {
      const discover = provider.models?.discoverInEnvironment;
      if (!discover) continue;
      const executor: HarnessCommandExecutor = { run: async (request) => { seen.push(request); return { stdout: OUTPUTS[provider.descriptor.id] ?? '', stderr: '', exitCode: 0 }; } };
      await discover(executor);
      expect(Object.keys(executor)).toEqual(['run']);
    }
    expect(seen.length).toBe(5);
    expect(JSON.stringify(seen)).not.toContain('me@remote');
  });

  it('yields no catalog on failure, non-zero exit, or transport error: no fallback, no desktop list', async () => {
    for (const exec of [
      vi.fn().mockResolvedValue({ stdout: '', stderr: 'boom', exitCode: 1 }),
      vi.fn().mockRejectedValue(new SshExecutionError('Permission denied', 255, '', 'Permission denied')),
      vi.fn().mockRejectedValue(new SshExecutionError('failed', 1, '', 'not found')),
    ]) {
      expect(await setup(exec).discoverHarnessModels('opencode')).toEqual([]);
      expect(await setup(exec).discoverHarnessModels('agy')).toEqual([]);
    }
  });

  it('does not query unsupported harnesses: Claude and Hermes run nothing', async () => {
    const exec = vi.fn();
    const env = setup(exec);
    expect(await env.discoverHarnessModels('claude')).toEqual([]);
    expect(await env.discoverHarnessModels('hermes')).toEqual([]);
    expect(await env.discoverHarnessModels('unknown')).toEqual([]);
    expect(exec).not.toHaveBeenCalled();
  });

  it('passes an explicitly selected model to the remote CLI spawn, and none by default', async () => {
    const env = setup(vi.fn());
    const withModel = await env.resolveTerminalSpawn({ id: 't1', workingDir: '/srv/app', harness: 'codex', model: 'remote-a' });
    expect(withModel.spawnArgs[2]).toMatch(/-m\W+remote-a/);
    const without = await env.resolveTerminalSpawn({ id: 't2', workingDir: '/srv/app', harness: 'codex' });
    expect(without.spawnArgs[2]).not.toMatch(/-m\W+remote-a|\W-m\W/);
  });
});
