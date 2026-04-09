import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listDirectory } from '../../../src/main/fileService';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('listDirectory', () => {
  it('lists directories asynchronously with folders first and alphabetical sorting', async () => {
    const workspaceRoot = makeTempDir('clanker-grid-file-service-');
    fs.mkdirSync(path.join(workspaceRoot, 'src'));
    fs.mkdirSync(path.join(workspaceRoot, 'z-folder'));
    fs.writeFileSync(path.join(workspaceRoot, '.env'), 'SECRET=1');
    fs.writeFileSync(path.join(workspaceRoot, 'README.md'), '# readme');

    try {
      const result = await listDirectory({
        workspacePath: workspaceRoot,
        directoryPath: workspaceRoot,
      });

      expect(result.success).toBe(true);
      expect(result.entries.map((entry) => entry.name)).toEqual([
        'src',
        'z-folder',
        '.env',
        'README.md',
      ]);
      expect(result.entries.find((entry) => entry.name === 'src')?.isDirectory).toBe(true);
      expect(result.entries.find((entry) => entry.name === '.env')).toBeTruthy();
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rejects directory traversal outside the workspace root', async () => {
    const parentRoot = makeTempDir('clanker-grid-file-service-parent-');
    const workspaceRoot = path.join(parentRoot, 'workspace');
    const outsideRoot = path.join(parentRoot, 'outside');
    fs.mkdirSync(workspaceRoot);
    fs.mkdirSync(outsideRoot);
    fs.mkdirSync(path.join(outsideRoot, 'nested'));

    try {
      const result = await listDirectory({
        workspacePath: workspaceRoot,
        directoryPath: outsideRoot,
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('invalid-path');
      expect(result.entries).toEqual([]);
    } finally {
      fs.rmSync(parentRoot, { recursive: true, force: true });
    }
  });

  it('rejects symlink traversal outside the workspace root', async () => {
    const parentRoot = makeTempDir('clanker-grid-file-service-symlink-');
    const workspaceRoot = path.join(parentRoot, 'workspace');
    const outsideRoot = path.join(parentRoot, 'outside');
    const linkPath = path.join(workspaceRoot, 'linked-outside');
    fs.mkdirSync(workspaceRoot);
    fs.mkdirSync(outsideRoot);
    fs.symlinkSync(outsideRoot, linkPath);

    try {
      const result = await listDirectory({
        workspacePath: workspaceRoot,
        directoryPath: linkPath,
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('invalid-path');
    } finally {
      fs.rmSync(parentRoot, { recursive: true, force: true });
    }
  });

  it('returns a permission error when directory listing fails', async () => {
    const workspaceRoot = makeTempDir('clanker-grid-file-service-permissions-');
    const privateDirectory = path.join(workspaceRoot, 'private');
    fs.mkdirSync(privateDirectory);
    fs.chmodSync(privateDirectory, 0o000);

    try {
      const result = await listDirectory({
        workspacePath: workspaceRoot,
        directoryPath: privateDirectory,
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('permission-denied');
      expect(result.entries).toEqual([]);
    } finally {
      fs.chmodSync(privateDirectory, 0o755);
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
