import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { codexArgsConflict } from '../../../src/main/harnesses/codex/attention';
import { prepareSshAttention } from '../../../src/main/remote/sshAgentAttention';
import type { SshCommandExecutor } from '../../../src/main/remote/sshCommandExecutor';

const homes: string[] = [];
afterEach(() => homes.splice(0).forEach((home) => rmSync(home, { recursive: true, force: true })));

/** Runs the real host preparation script locally with a throwaway HOME, so the Python
 * parser is exercised with the same inputs as the local TypeScript parser. */
async function remoteConflicts(args: string[]): Promise<boolean> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'clanker-codex-conflict-')));
  homes.push(home);
  const exec = vi.fn(async (_target: string, command: string, commandArgs: string[], options?: { input?: string | Buffer }) => {
    const result = spawnSync(command === 'sh' ? '/bin/sh' : command, commandArgs, { input: options?.input, encoding: 'utf8',
      env: { ...process.env, HOME: home, CODEX_HOME: '' } });
    if (result.status !== 0) throw new Error(result.stderr);
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  });
  try {
    const prepared = await prepareSshAttention({ exec } as unknown as SshCommandExecutor, 'host', 'codex', args, 'a'.repeat(64));
    await prepared.release();
    return false;
  } catch (error) {
    if (/Codex (profile|hook|app-server)/.test(String(error))) return true;
    throw error;
  }
}

// Every form the Codex CLI accepts for config overrides and profiles, plus unrelated settings that
// must not be treated as the user's hook/profile configuration.
const CONFLICTS: string[][] = [
  ['-c', 'hooks.Stop=[]'], ['--config', 'hooks.Stop=[]'], ['-chooks.Stop=[]'], ['--config=hooks.Stop=[]'],
  ['-c', ' hooks . Stop = []'], ['-c', 'hooks={}'], ['--config', 'hooks=[]'],
  ['-c', 'profile="work"'], ['-cprofile="work"'], ['--config=profile="work"'], ['--config', ' profile = "work"'],
  ['-c', 'profiles.work.hooks.Stop=[]'], ['--config=profiles.work.hooks.PostToolUse=[]'],
  ['-p', 'work'], ['-pwork'], ['--profile', 'work'], ['--profile=work'],
  ['--model', 'gpt-x', '-c', 'hooks.SessionEnd=[]'],
  ['--remote', 'unix:///fixture'], ['--remote=unix:///fixture'], ['--remote-auth-token-env', 'FIXTURE_TOKEN'], ['--remote-auth-token-env=FIXTURE_TOKEN'],
];
const UNRELATED: string[][] = [
  [], ['-c', 'sandbox_mode="read-only"'], ['--config', 'model_reasoning_effort="high"'], ['-csandbox_mode="read-only"'],
  ['--config=shell_environment_policy.inherit="all"'], ['-c', 'profiles.work.model="x"'], ['-m', 'gpt-x'],
  ['--cd', '/work'], ['resume', 'abc'], ['-c', 'tools.web_search=true'],
];

describe('Codex hook/profile conflict detection', () => {
  it.each(CONFLICTS)('local parser treats %j as a conflict', (...args) => {
    expect(codexArgsConflict(args)).toBe(true);
  });
  it.each(UNRELATED)('local parser leaves %j alone', (...args) => {
    expect(codexArgsConflict(args)).toBe(false);
  });
  // The host script runs under /bin/sh on a POSIX SSH host.
  it.skipIf(process.platform === 'win32')('remote preparation reaches the same decision for every form', async () => {
    for (const args of CONFLICTS) expect(await remoteConflicts(args), JSON.stringify(args)).toBe(true);
    for (const args of UNRELATED) expect(await remoteConflicts(args), JSON.stringify(args)).toBe(false);
  });
});
