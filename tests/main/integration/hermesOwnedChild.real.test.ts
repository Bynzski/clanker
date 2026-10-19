import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { HermesOwnedChild } from '../../../src/main/assistants/hermesOwnedChild';

async function nativeChild(ignoreTerm: boolean) {
  const child = spawn(process.execPath, ['-e', `${ignoreTerm ? "process.on('SIGTERM', () => {});" : ''} process.stdout.write('READY\\n'); setInterval(() => {}, 1000);`], {
    env: {}, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const owned = new HermesOwnedChild(child, () => {});
  const exit = once(child, 'exit');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      once(child.stdout, 'data'),
      exit.then(() => { throw new Error('Fixture exited before readiness'); }),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Fixture readiness timeout')), 3000); }),
    ]);
  } catch (error) {
    child.kill('SIGKILL'); await exit; throw error;
  } finally { clearTimeout(timer); }
  return { child, owned, exit };
}

describe('native exact-child exit acknowledgement (no Hermes installation required)', () => {
  it('waits for a real graceful signal exit and accepts null exitCode', async () => {
    const { child, owned, exit } = await nativeChild(false);
    try {
      await owned.stop(1500, 1500);
      expect(owned.hasExited).toBe(true);
      expect(child.exitCode).toBeNull();
      expect(child.signalCode).toBe('SIGTERM');
    } finally { if (!owned.hasExited) child.kill('SIGKILL'); await exit; }
  });

  it.skipIf(process.platform === 'win32')('escalates a real TERM-ignoring child and waits for SIGKILL exit', async () => {
    const { child, owned, exit } = await nativeChild(true);
    try {
      await owned.stop(20, 1500);
      expect(owned.hasExited).toBe(true);
      expect(child.exitCode).toBeNull();
      expect(child.signalCode).toBe('SIGKILL');
      expect(owned.cleanupIncomplete).toBe(false);
    } finally { if (!owned.hasExited) child.kill('SIGKILL'); await exit; }
  });

  it('confirms a real spawn failure without waiting for an exit event that never occurs', async () => {
    const child = spawn(process.execPath, [], { cwd: join(tmpdir(), `clanker-missing-hermes-child-${randomUUID()}`), env: {} });
    const owned = new HermesOwnedChild(child, () => {});
    const error = once(child, 'error');
    await error;
    expect(child.pid).toBeUndefined();
    await owned.stop(10, 10);
    expect(owned.hasExited).toBe(true);
    expect(owned.cleanupIncomplete).toBe(false);
  });
});
