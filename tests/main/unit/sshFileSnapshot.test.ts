import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { snapshotSshFiles } from '../../../src/main/remote/sshFileSnapshot';
import type { SshCommandExecutor, SshExecOptions } from '../../../src/main/remote/sshCommandExecutor';

describe('remote snapshot validation', () => {
  it('rejects traversal and over-limit requests before invoking SSH', async () => {
    const exec = vi.fn();
    const executor = { exec } as unknown as SshCommandExecutor;
    await expect(snapshotSshFiles(executor, 'host', '/ws', { filePaths: ['/ws/../outside'], directoryPaths: [] })).rejects.toThrow('Invalid');
    await expect(snapshotSshFiles(executor, 'host', '/ws', { filePaths: [], directoryPaths: Array(129).fill('/ws') })).rejects.toThrow('Invalid');
    expect(exec).not.toHaveBeenCalled();
  });

  it('rejects forged or duplicate snapshot paths', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: JSON.stringify({ files: [{ path: '/outside', fingerprint: 'a'.repeat(64) }], directories: [] }) });
    const executor = { exec } as unknown as SshCommandExecutor;
    await expect(snapshotSshFiles(executor, 'host', '/ws', { filePaths: ['/ws/a'], directoryPaths: [] })).rejects.toThrow('Invalid');
  });
});

const pythonAvailable = spawnSync('python3', ['--version']).status === 0;
describe.skipIf(process.platform === 'win32' || !pythonAvailable)('remote snapshot Python protocol', () => {
  let fixture: string;
  let root: string;
  const executor = {
    exec: async (_target: string, command: string, args: string[], options: SshExecOptions) => ({
      stdout: execFileSync(command, args, { input: options.input, maxBuffer: options.maxBuffer, encoding: 'utf8' }), stderr: '', exitCode: 0,
    }),
  } as unknown as SshCommandExecutor;

  beforeEach(() => {
    fixture = realpathSync(mkdtempSync(join(tmpdir(), 'clanker-snapshot-')));
    root = join(fixture, 'workspace');
    mkdirSync(root);
  });
  afterEach(() => rmSync(fixture, { recursive: true, force: true }));

  it('detects edits and direct directory changes and represents deleted files explicitly', async () => {
    const file = join(root, 'file.txt');
    writeFileSync(file, 'before');
    const targets = { filePaths: [file], directoryPaths: [root] };
    const first = await snapshotSshFiles(executor, 'host', root, targets);
    writeFileSync(file, 'after with different size');
    mkdirSync(join(root, 'new-directory'));
    const second = await snapshotSshFiles(executor, 'host', root, targets);
    expect(second.files[0].fingerprint).not.toBe(first.files[0].fingerprint);
    expect(second.directories[0].fingerprint).not.toBe(first.directories[0].fingerprint);
    rmSync(file);
    expect((await snapshotSshFiles(executor, 'host', root, targets)).files).toEqual([{ path: file, fingerprint: null }]);
  });

  it('omits escaping symlinks and bounds direct directory scans', async () => {
    const outside = join(fixture, 'secret');
    writeFileSync(outside, 'private');
    const link = join(root, 'link');
    symlinkSync(outside, link);
    const result = await snapshotSshFiles(executor, 'host', root, { filePaths: [link], directoryPaths: [root] });
    expect(result.files).toEqual([]);
    expect(result.directories).toHaveLength(1);
    const large = join(root, 'large');
    mkdirSync(large);
    for (let index = 0; index < 2001; index++) writeFileSync(join(large, String(index)), '');
    expect((await snapshotSshFiles(executor, 'host', root, { filePaths: [], directoryPaths: [large] })).directories).toEqual([]);
  });

  it('fails closed when the registered root is replaced by a symlink', async () => {
    rmSync(root, { recursive: true });
    const outside = join(fixture, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, root);
    await expect(snapshotSshFiles(executor, 'host', root, { filePaths: [], directoryPaths: [root] })).rejects.toThrow();
  });

  it('does not follow a symlink substituted after resolving a watched file', async () => {
    const file = join(root, 'watched');
    const outside = join(fixture, 'outside');
    writeFileSync(file, 'inside');
    writeFileSync(outside, 'outside');
    const racingExecutor = {
      exec: async (_target: string, command: string, args: string[], options: SshExecOptions) => {
        const injected = args[1].replace('  relative = os.path.relpath(real, root)', `  os.unlink(target)\n  os.symlink(${JSON.stringify(outside)}, target)\n  relative = os.path.relpath(real, root)`);
        return { stdout: execFileSync(command, [args[0], injected, args[2]], { input: options.input, encoding: 'utf8' }), stderr: '', exitCode: 0 };
      },
    } as unknown as SshCommandExecutor;
    expect((await snapshotSshFiles(racingExecutor, 'host', root, { filePaths: [file], directoryPaths: [] })).files).toEqual([]);
  });
});
