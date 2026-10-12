import { describe, expect, test } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { computeDevVersion, getGitCommitSha } = require('../../../scripts/build-dist-dev.cjs') as {
  computeDevVersion: (options?: { cwd?: string; shaLength?: number }) => string;
  getGitCommitSha: (cwd?: string, length?: number) => string | null;
};

describe('dev build version computation', () => {
  test('formats version with base package version, dev marker, and commit SHA', () => {
    const version = computeDevVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+-dev\.[0-9a-f]{7,}$/);
  });

  test('supports custom sha length', () => {
    const version = computeDevVersion({ shaLength: 10 });
    expect(version).toMatch(/^\d+\.\d+\.\d+-dev\.[0-9a-f]{10}$/);
  });

  test('falls back to unknown if directory is not a git repository', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-dev-test-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ version: '1.2.3' }), 'utf8');
      const version = computeDevVersion({ cwd: tmpDir });
      expect(version).toBe('1.2.3-dev.unknown');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('getGitCommitSha returns a string for the current repository', () => {
    const sha = getGitCommitSha();
    expect(typeof sha).toBe('string');
    expect(sha?.length).toBeGreaterThanOrEqual(7);
  });
});
