import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { readFile, writeFile } from '../../../src/main/fileService';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

afterEach(() => {
  // Clean up any remaining temp files
});

describe('readFile', () => {
  it('reads a text file successfully', async () => {
    const workspaceRoot = makeTempDir('clanker-grid-editor-read-');
    const filePath = path.join(workspaceRoot, 'test.txt');
    fs.writeFileSync(filePath, 'Hello, world!');

    try {
      const result = await readFile({
        workspacePath: workspaceRoot,
        filePath: filePath,
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe('Hello, world!');
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rejects files outside workspace (path traversal)', async () => {
    const parentRoot = makeTempDir('clanker-grid-editor-outside-');
    const workspaceRoot = path.join(parentRoot, 'workspace');
    const outsideFile = path.join(parentRoot, 'secret.txt');
    fs.mkdirSync(workspaceRoot);
    fs.writeFileSync(outsideFile, 'secret data');

    try {
      const result = await readFile({
        workspacePath: workspaceRoot,
        filePath: outsideFile,
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('invalid-path');
    } finally {
      fs.rmSync(parentRoot, { recursive: true, force: true });
    }
  });

  it('rejects files exceeding 1 MB', async () => {
    const workspaceRoot = makeTempDir('clanker-grid-editor-large-');
    const filePath = path.join(workspaceRoot, 'large.txt');
    // Write a file larger than 1 MB (1,048,576 bytes)
    const largeContent = 'x'.repeat(1_100_000);
    fs.writeFileSync(filePath, largeContent);

    try {
      const result = await readFile({
        workspacePath: workspaceRoot,
        filePath: filePath,
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('file-too-large');
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rejects binary files (file containing null bytes)', async () => {
    const workspaceRoot = makeTempDir('clanker-grid-editor-binary-');
    const filePath = path.join(workspaceRoot, 'binary.bin');
    // Write a file with a null byte in the first 8192 bytes
    const binaryContent = Buffer.alloc(100);
    binaryContent[50] = 0; // null byte at position 50
    fs.writeFileSync(filePath, binaryContent);

    try {
      const result = await readFile({
        workspacePath: workspaceRoot,
        filePath: filePath,
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('binary-file');
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('returns not-found for missing files', async () => {
    const workspaceRoot = makeTempDir('clanker-grid-editor-missing-');
    // makeTempDir already creates the directory

    try {
      const result = await readFile({
        workspacePath: workspaceRoot,
        filePath: path.join(workspaceRoot, 'nonexistent.txt'),
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('not-found');
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rejects directories as file paths', async () => {
    const workspaceRoot = makeTempDir('clanker-grid-editor-dir-');
    const dirPath = path.join(workspaceRoot, 'subdir');
    fs.mkdirSync(dirPath);

    try {
      const result = await readFile({
        workspacePath: workspaceRoot,
        filePath: dirPath,
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('invalid-path');
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('handles symlink traversal', async () => {
    const parentRoot = makeTempDir('clanker-grid-editor-symlink-');
    const workspaceRoot = path.join(parentRoot, 'workspace');
    const outsideFile = path.join(parentRoot, 'outside.txt');
    const linkPath = path.join(workspaceRoot, 'linked');
    fs.mkdirSync(workspaceRoot);
    fs.writeFileSync(outsideFile, 'outside data');
    fs.symlinkSync(outsideFile, linkPath);

    try {
      const result = await readFile({
        workspacePath: workspaceRoot,
        filePath: linkPath,
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('invalid-path');
    } finally {
      fs.rmSync(parentRoot, { recursive: true, force: true });
    }
  });
});

describe('writeFile', () => {
  it('writes content to a file successfully', async () => {
    const workspaceRoot = makeTempDir('clanker-grid-editor-write-');
    const filePath = path.join(workspaceRoot, 'new.txt');

    try {
      const result = await writeFile({
        workspacePath: workspaceRoot,
        filePath: filePath,
        content: 'Hello, write!',
      });

      expect(result.success).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('Hello, write!');
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('overwrites existing file content', async () => {
    const workspaceRoot = makeTempDir('clanker-grid-editor-overwrite-');
    const filePath = path.join(workspaceRoot, 'existing.txt');
    fs.writeFileSync(filePath, 'original content');

    try {
      const result = await writeFile({
        workspacePath: workspaceRoot,
        filePath: filePath,
        content: 'updated content',
      });

      expect(result.success).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('updated content');
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rejects paths outside workspace', async () => {
    const parentRoot = makeTempDir('clanker-grid-editor-write-outside-');
    const workspaceRoot = path.join(parentRoot, 'workspace');
    const outsideFile = path.join(parentRoot, 'outside.txt');
    fs.mkdirSync(workspaceRoot);

    try {
      const result = await writeFile({
        workspacePath: workspaceRoot,
        filePath: outsideFile,
        content: 'should fail',
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('invalid-path');
    } finally {
      fs.rmSync(parentRoot, { recursive: true, force: true });
    }
  });

  it('creates parent directories if needed', async () => {
    const workspaceRoot = makeTempDir('clanker-grid-editor-mkdir-');
    const subDir = path.join(workspaceRoot, 'subdir', 'nested');
    const filePath = path.join(subDir, 'file.txt');

    try {
      const result = await writeFile({
        workspacePath: workspaceRoot,
        filePath: filePath,
        content: 'nested content',
      });

      expect(result.success).toBe(true);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('nested content');
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('handles symlink traversal on write', async () => {
    const parentRoot = makeTempDir('clanker-grid-editor-write-symlink-');
    const workspaceRoot = path.join(parentRoot, 'workspace');
    const outsideFile = path.join(parentRoot, 'outside.txt');
    const linkPath = path.join(workspaceRoot, 'linked');
    fs.mkdirSync(workspaceRoot);
    fs.writeFileSync(outsideFile, 'outside data');
    fs.symlinkSync(outsideFile, linkPath);

    try {
      const result = await writeFile({
        workspacePath: workspaceRoot,
        filePath: linkPath,
        content: 'should fail',
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('invalid-path');
    } finally {
      fs.rmSync(parentRoot, { recursive: true, force: true });
    }
  });
});