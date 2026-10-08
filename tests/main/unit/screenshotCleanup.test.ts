import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const require = createRequire(import.meta.url);
const { stopOwnedCodexDaemons } = require('../../../scripts/screenshots/cleanup.cjs') as {
  stopOwnedCodexDaemons(root: string): Promise<void>;
};

describe('capture-owned daemon cleanup', () => {
  it.skipIf(process.platform !== 'linux')('stops only Codex app-server executables inside this capture HOME', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clanker-capture-cleanup-'));
    const dir = join(root, 'home', '.codex', 'packages', 'test');
    mkdirSync(dir, { recursive: true });
    const executable = join(dir, 'codex');
    symlinkSync(process.execPath, executable);
    const args = ['-e', 'setInterval(() => {}, 1000)', 'app-server'];
    const owned = spawn(executable, args, { stdio: 'ignore' });
    const unrelated = spawn(process.execPath, args, { stdio: 'ignore' });
    const ownedExit = once(owned, 'exit');
    const unrelatedExit = once(unrelated, 'exit');
    try {
      await Promise.all([once(owned, 'spawn'), once(unrelated, 'spawn')]);
      await stopOwnedCodexDaemons(root);
      const [, signal] = await ownedExit;
      expect(signal).toBe('SIGTERM');
      expect(unrelated.exitCode).toBeNull();
      expect(unrelated.signalCode).toBeNull();
    } finally {
      owned.kill(); unrelated.kill();
      await Promise.all([ownedExit, unrelatedExit]);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
