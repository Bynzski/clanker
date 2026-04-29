import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFile, createDirectory, deleteEntry, renameEntry } from '../../../src/main/fileService';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createFile', () => {
  it('creates a file successfully inside the workspace', async () => {
    const workspaceRoot = makeTempDir('clanker-grid-create-file-');
    const targetPath = path.join(workspaceRoot, 'newfile.txt');

    try {
      const result = await createFile({
        workspacePath: workspaceRoot,
        targetPath,
        type: 'file',
      });

      expect(result.success).toBe(true);
      expect(fs.existsSync(targetPath)).toBe(true);
      expect(fs.readFileSync(targetPath, 'utf-8')).toBe('');
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('creates a file with nested parent directories', async () => {
    const workspaceRoot = makeTempDir('clanker-grid-create-nested-');
    const targetPath = path.join(workspaceRoot, 'src', 'deep', 'nested', 'file.txt');

    try {
      const result = await createFile({
        workspacePath: workspaceRoot,
        targetPath,
        type: 'file',
      });

      expect(result.success).toBe(true);
      expect(fs.existsSync(targetPath)).toBe(true);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rejects creating a file outside the workspace', async () => {
    const parentRoot = makeTempDir('clanker-grid-create-outside-');
    const workspaceRoot = path.join(parentRoot, 'workspace');
    const outsidePath = path.join(parentRoot, 'outside', 'evil.txt');
    fs.mkdirSync(workspaceRoot, { recursive: true });

    try {
      const result = await createFile({
        workspacePath: workspaceRoot,
        targetPath: outsidePath,
        type: 'file',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('outside workspace');
    } finally {
      fs.rmSync(parentRoot, { recursive: true, force: true });
    }
  });

  it('rejects creating a file when path resolves outside workspace via symlink', async () => {
    const parentRoot = makeTempDir('clanker-grid-create-symlink-');
    const workspaceRoot = path.join(parentRoot, 'workspace');
    const outsideDir = path.join(parentRoot, 'outside');
    const linkPath = path.join(workspaceRoot, 'link-to-outside');
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.symlinkSync(outsideDir, linkPath);

    try {
      const result = await createFile({
        workspacePath: workspaceRoot,
        targetPath: path.join(linkPath, 'file.txt'),
        type: 'file',
      });

      // The path resolves to outsideDir/file.txt which is outside workspace
      expect(result.success).toBe(false);
      expect(result.error).toContain('outside workspace');
    } finally {
      fs.rmSync(parentRoot, { recursive: true, force: true });
    }
  });

  it('rejects reserved filenames on create', async () => {
    const workspaceRoot = makeTempDir('clanker-grid-create-reserved-');
    const targetPath = path.join(workspaceRoot, 'CON.txt');

    try {
      const result = await createFile({
        workspacePath: workspaceRoot,
        targetPath,
        type: 'file',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('reserved');
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rejects nested reserved path components on create', async () => {
    const workspaceRoot = makeTempDir('clanker-grid-create-reserved-nested-');
    const targetPath = path.join(workspaceRoot, 'src', 'AUX', 'file.txt');

    try {
      const result = await createFile({
        workspacePath: workspaceRoot,
        targetPath,
        type: 'file',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('reserved');
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rejects creating a file that already exists', async () => {
    const workspaceRoot = makeTempDir('clanker-grid-create-exists-');
    const targetPath = path.join(workspaceRoot, 'existing.txt');
    fs.writeFileSync(targetPath, 'hello');

    try {
      const result = await createFile({
        workspacePath: workspaceRoot,
        targetPath,
        type: 'file',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

describe('createDirectory', () => {
  it('creates a directory successfully inside the workspace', async () => {
    const workspaceRoot = makeTempDir('clanker-grid-create-dir-');
    const targetPath = path.join(workspaceRoot, 'newdir');

    try {
      const result = await createDirectory({
        workspacePath: workspaceRoot,
        targetPath,
        type: 'directory',
      });

      expect(result.success).toBe(true);
      expect(fs.existsSync(targetPath)).toBe(true);
      expect(fs.statSync(targetPath).isDirectory()).toBe(true);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('creates nested directories', async () => {
    const workspaceRoot = makeTempDir('clanker-grid-create-nested-dir-');
    const targetPath = path.join(workspaceRoot, 'a', 'b', 'c');

    try {
      const result = await createDirectory({
        workspacePath: workspaceRoot,
        targetPath,
        type: 'directory',
      });

      expect(result.success).toBe(true);
      expect(fs.existsSync(targetPath)).toBe(true);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rejects creating a directory outside the workspace', async () => {
    const parentRoot = makeTempDir('clanker-grid-create-dir-outside-');
    const workspaceRoot = path.join(parentRoot, 'workspace');
    const outsidePath = path.join(parentRoot, 'outside', 'dir');
    fs.mkdirSync(workspaceRoot, { recursive: true });

    try {
      const result = await createDirectory({
        workspacePath: workspaceRoot,
        targetPath: outsidePath,
        type: 'directory',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('outside workspace');
    } finally {
      fs.rmSync(parentRoot, { recursive: true, force: true });
    }
  });

  it('rejects creating a directory that already exists', async () => {
    const workspaceRoot = makeTempDir('clanker-grid-create-dir-exists-');
    const targetPath = path.join(workspaceRoot, 'existing');
    fs.mkdirSync(targetPath);

    try {
      const result = await createDirectory({
        workspacePath: workspaceRoot,
        targetPath,
        type: 'directory',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

describe('deleteEntry', () => {
  it('deletes a file successfully', async () => {
    const workspaceRoot = makeTempDir('clanker-grid-delete-file-');
    const targetPath = path.join(workspaceRoot, 'todelete.txt');
    fs.writeFileSync(targetPath, 'hello');

    try {
      const result = await deleteEntry({
        workspacePath: workspaceRoot,
        targetPath,
      });

      expect(result.success).toBe(true);
      expect(fs.existsSync(targetPath)).toBe(false);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('deletes a directory recursively', async () => {
    const workspaceRoot = makeTempDir('clanker-grid-delete-dir-');
    const targetPath = path.join(workspaceRoot, 'todelete');
    fs.mkdirSync(path.join(targetPath, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(targetPath, 'file.txt'), 'content');
    fs.writeFileSync(path.join(targetPath, 'sub', 'nested.txt'), 'nested');

    try {
      const result = await deleteEntry({
        workspacePath: workspaceRoot,
        targetPath,
      });

      expect(result.success).toBe(true);
      expect(fs.existsSync(targetPath)).toBe(false);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rejects deleting the workspace root itself', async () => {
    const workspaceRoot = makeTempDir('clanker-grid-delete-root-');

    try {
      const result = await deleteEntry({
        workspacePath: workspaceRoot,
        targetPath: workspaceRoot,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('workspace root');
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rejects deleting a path outside the workspace', async () => {
    const parentRoot = makeTempDir('clanker-grid-delete-outside-');
    const workspaceRoot = path.join(parentRoot, 'workspace');
    const outsidePath = path.join(parentRoot, 'outside', 'file.txt');
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.mkdirSync(path.join(parentRoot, 'outside'), { recursive: true });
    fs.writeFileSync(outsidePath, 'evil');

    try {
      const result = await deleteEntry({
        workspacePath: workspaceRoot,
        targetPath: outsidePath,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('outside workspace');
    } finally {
      fs.rmSync(parentRoot, { recursive: true, force: true });
    }
  });

  it('rejects symlink traversal — deleting symlink target outside workspace', async () => {
    const parentRoot = makeTempDir('clanker-grid-delete-symlink-');
    const workspaceRoot = path.join(parentRoot, 'workspace');
    const outsideDir = path.join(parentRoot, 'outside');
    const linkPath = path.join(workspaceRoot, 'link-to-outside');
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.symlinkSync(outsideDir, linkPath);

    try {
      const result = await deleteEntry({
        workspacePath: workspaceRoot,
        targetPath: linkPath,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('outside workspace');
    } finally {
      fs.rmSync(parentRoot, { recursive: true, force: true });
    }
  });

  it('rejects deleting a non-existent path', async () => {
    const workspaceRoot = makeTempDir('clanker-grid-delete-nonexistent-');
    const nonexistentPath = path.join(workspaceRoot, 'doesnotexist.txt');

    try {
      const result = await deleteEntry({
        workspacePath: workspaceRoot,
        targetPath: nonexistentPath,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not exist');
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

describe('renameEntry', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('renames a file successfully', async () => {
    const workspaceRoot = makeTempDir('clanker-grid-rename-file-');
    const oldPath = path.join(workspaceRoot, 'oldname.txt');
    const newPath = path.join(workspaceRoot, 'newname.txt');
    fs.writeFileSync(oldPath, 'content');

    try {
      const result = await renameEntry({
        workspacePath: workspaceRoot,
        oldPath,
        newPath,
      });

      expect(result.success).toBe(true);
      expect(fs.existsSync(oldPath)).toBe(false);
      expect(fs.existsSync(newPath)).toBe(true);
      expect(fs.readFileSync(newPath, 'utf-8')).toBe('content');
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('supports Windows case-only rename', async () => {
    if (originalPlatform !== 'win32') {
      return;
    }

    const workspaceRoot = makeTempDir('clanker-grid-rename-case-only-');
    const oldPath = path.join(workspaceRoot, 'Foo.txt');
    const newPath = path.join(workspaceRoot, 'foo.txt');
    fs.writeFileSync(oldPath, 'content');

    try {
      const result = await renameEntry({
        workspacePath: workspaceRoot,
        oldPath,
        newPath,
      });

      expect(result.success).toBe(true);
      expect(fs.existsSync(newPath)).toBe(true);
      expect(fs.readFileSync(newPath, 'utf-8')).toBe('content');
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('renames a directory successfully', async () => {
    const workspaceRoot = makeTempDir('clanker-grid-rename-dir-');
    const oldPath = path.join(workspaceRoot, 'olddir');
    const newPath = path.join(workspaceRoot, 'newdir');
    fs.mkdirSync(path.join(oldPath, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(oldPath, 'file.txt'), 'content');

    try {
      const result = await renameEntry({
        workspacePath: workspaceRoot,
        oldPath,
        newPath,
      });

      expect(result.success).toBe(true);
      expect(fs.existsSync(oldPath)).toBe(false);
      expect(fs.existsSync(newPath)).toBe(true);
      expect(fs.existsSync(path.join(newPath, 'file.txt'))).toBe(true);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rejects renaming when destination already exists', async () => {
    const workspaceRoot = makeTempDir('clanker-grid-rename-exists-');
    const oldPath = path.join(workspaceRoot, 'old.txt');
    const newPath = path.join(workspaceRoot, 'existing.txt');
    fs.writeFileSync(oldPath, 'old content');
    fs.writeFileSync(newPath, 'existing content');

    try {
      const result = await renameEntry({
        workspacePath: workspaceRoot,
        oldPath,
        newPath,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
      // Original file should be untouched
      expect(fs.readFileSync(oldPath, 'utf-8')).toBe('old content');
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rejects renaming a path outside the workspace', async () => {
    const parentRoot = makeTempDir('clanker-grid-rename-outside-');
    const workspaceRoot = path.join(parentRoot, 'workspace');
    const outsidePath = path.join(parentRoot, 'outside', 'old.txt');
    const outsideNewPath = path.join(parentRoot, 'outside', 'new.txt');
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.mkdirSync(path.join(parentRoot, 'outside'), { recursive: true });
    fs.writeFileSync(outsidePath, 'evil');

    try {
      const result = await renameEntry({
        workspacePath: workspaceRoot,
        oldPath: outsidePath,
        newPath: outsideNewPath,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('outside workspace');
    } finally {
      fs.rmSync(parentRoot, { recursive: true, force: true });
    }
  });

  it('rejects symlink traversal on rename — source outside workspace', async () => {
    const parentRoot = makeTempDir('clanker-grid-rename-symlink-');
    const workspaceRoot = path.join(parentRoot, 'workspace');
    const outsideDir = path.join(parentRoot, 'outside');
    const linkPath = path.join(workspaceRoot, 'link-to-outside');
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'secret');
    fs.symlinkSync(outsideDir, linkPath);

    try {
      const result = await renameEntry({
        workspacePath: workspaceRoot,
        oldPath: path.join(linkPath, 'secret.txt'),
        newPath: path.join(workspaceRoot, 'stolen.txt'),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('outside workspace');
    } finally {
      fs.rmSync(parentRoot, { recursive: true, force: true });
    }
  });

  it('rejects symlink traversal on rename — destination inside symlinked parent', async () => {
    const parentRoot = makeTempDir('clanker-grid-rename-destination-symlink-');
    const workspaceRoot = path.join(parentRoot, 'workspace');
    const outsideDir = path.join(parentRoot, 'outside');
    const linkPath = path.join(workspaceRoot, 'link-to-outside');
    const oldPath = path.join(workspaceRoot, 'old.txt');
    const newPath = path.join(linkPath, 'stolen.txt');

    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(oldPath, 'hello');
    fs.symlinkSync(outsideDir, linkPath);

    try {
      const result = await renameEntry({
        workspacePath: workspaceRoot,
        oldPath,
        newPath,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('outside workspace');
      expect(fs.existsSync(oldPath)).toBe(true);
      expect(fs.existsSync(path.join(outsideDir, 'stolen.txt'))).toBe(false);
    } finally {
      fs.rmSync(parentRoot, { recursive: true, force: true });
    }
  });

  it('rejects reserved filenames on rename', async () => {
    const workspaceRoot = makeTempDir('clanker-grid-rename-reserved-');
    const oldPath = path.join(workspaceRoot, 'old.txt');
    const newPath = path.join(workspaceRoot, 'NUL.txt');
    fs.writeFileSync(oldPath, 'content');

    try {
      const result = await renameEntry({
        workspacePath: workspaceRoot,
        oldPath,
        newPath,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('reserved');
      expect(fs.existsSync(oldPath)).toBe(true);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rejects nested reserved path components on rename destination', async () => {
    const workspaceRoot = makeTempDir('clanker-grid-rename-reserved-nested-');
    const oldPath = path.join(workspaceRoot, 'old.txt');
    const newPath = path.join(workspaceRoot, 'src', 'CON', 'new.txt');
    fs.writeFileSync(oldPath, 'content');

    try {
      const result = await renameEntry({
        workspacePath: workspaceRoot,
        oldPath,
        newPath,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('reserved');
      expect(fs.existsSync(oldPath)).toBe(true);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rejects renaming a non-existent path', async () => {
    const workspaceRoot = makeTempDir('clanker-grid-rename-nonexistent-');
    const nonexistentPath = path.join(workspaceRoot, 'doesnotexist.txt');

    try {
      const result = await renameEntry({
        workspacePath: workspaceRoot,
        oldPath: nonexistentPath,
        newPath: path.join(workspaceRoot, 'new.txt'),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not exist');
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
