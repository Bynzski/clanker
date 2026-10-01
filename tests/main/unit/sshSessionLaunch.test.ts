import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SshEnvironment } from '../../../src/main/remote/sshEnvironment';
import type { HarnessSession } from '../../../src/shared/types/session';
import { buildSessionCommand } from '../../../src/main/sessionLaunch';

const pythonAvailable = spawnSync('python3', ['--version']).status === 0;
describe.skipIf(process.platform === 'win32' || !pythonAvailable)('SSH native session launch script', () => {
  let fixture: string;
  let home: string;
  let root: string;
  let cwd: string;
  const environment = new SshEnvironment({ id: 'ssh-host', kind: 'ssh', label: 'Host', target: 'user@host' });
  beforeEach(() => {
    fixture = realpathSync(mkdtempSync(join(tmpdir(), 'clanker-session-launch-')));
    home = join(fixture, 'home'); root = join(fixture, 'workspace'); cwd = join(root, 'nested');
    mkdirSync(home); mkdirSync(root); mkdirSync(cwd);
    mkdirSync(join(home, 'bin'));
    writeFileSync(join(home, 'shell'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  });
  afterEach(() => rmSync(fixture, { recursive: true, force: true }));
  function session(harness: HarnessSession['harness']): HarnessSession {
    const filePath = join(home, `.${harness}`, 'agent/sessions/project', 'session with space\\literal.jsonl');
    if (harness === 'pi' || harness === 'omp') {
      mkdirSync(join(filePath, '..'), { recursive: true }); writeFileSync(filePath, '{}');
    }
    return { id: 'native-id', harness, title: 'Title', cwd, timestamp: 1, modelId: 'host-model', provider: harness === 'pi' ? 'provider' : undefined, ...(harness === 'pi' || harness === 'omp' ? { filePath } : {}) };
  }
  function run(spawnArgs: string[]) {
    return spawnSync('sh', ['-c', spawnArgs[2]], { env: { HOME: home, PATH: `${home}/bin:/usr/bin:/bin`, SHELL: join(home, 'shell') }, encoding: 'utf8' });
  }
  it.each(['codex', 'claude', 'opencode', 'pi', 'omp', 'agy'] as const)('executes the %s resume command in the canonical remote session directory', async (harness) => {
    const selected = session(harness);
    writeFileSync(join(home, 'bin', harness), '#!/bin/sh\nprintf "%s\\n" "$PWD" "$@" > "$HOME/captured"\n', { mode: 0o700 });
    const resolved = await environment.resolveTerminalSpawn({ id: 'term', workingDir: cwd, harness, flags: '--verbose', resumeSession: { session: selected, fork: false, workspaceRoot: root } });
    expect(resolved.spawnCmd).toBe('ssh');
    expect(run(resolved.spawnArgs).status).toBe(0);
    expect(readFileSync(join(home, 'captured'), 'utf8').trim().split('\n')).toEqual([cwd, ...buildSessionCommand(selected, { operation: 'resume', transport: 'ssh', userFlags: '--verbose' }).args]);
  });
  it('refuses a directory or session file changed to an escaping symlink after preparation', async () => {
    const selected = session('pi');
    const resolved = await environment.resolveTerminalSpawn({ id: 'term', workingDir: cwd, harness: 'pi', resumeSession: { session: selected, fork: false, workspaceRoot: root } });
    const outside = join(fixture, 'outside'); mkdirSync(outside);
    rmSync(cwd, { recursive: true }); symlinkSync(outside, cwd);
    expect(run(resolved.spawnArgs).status).not.toBe(0);
    rmSync(cwd); mkdirSync(cwd);
    rmSync(selected.filePath!); symlinkSync(join(outside, 'file.jsonl'), selected.filePath!);
    expect(run(resolved.spawnArgs).status).not.toBe(0);
  });
});
