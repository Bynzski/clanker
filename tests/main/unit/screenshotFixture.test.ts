import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { createProject } = require('../../../scripts/screenshots/fixture.cjs') as {
  createProject(root: string, name: string, html: string): string;
};

describe('screenshot demo fixture', () => {
  it('creates real tests, history, branches, dirty changes and a linked checkout without dependencies', () => {
    const root = mkdtempSync(join(tmpdir(), 'clanker-fixture-test-'));
    try {
      const dir = createProject(root, 'northstar-app', '<h1>Local demo</h1>');
      const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
      expect(git('log', '--oneline')).toContain('Document development quality checks');
      expect(git('branch', '--list')).toContain('fix/keyboard-navigation');
      expect(git('worktree', 'list', '--porcelain')).toContain('refs/heads/feat/project-search');
      expect(git('status', '--porcelain')).toContain(' M src/projects.ts');
      expect(git('status', '--porcelain')).toContain('?? docs/release-notes.md');
      expect(readFileSync(join(dir, 'public/index.html'), 'utf8')).toBe('<h1>Local demo</h1>');
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { scripts: { dev: string }; dependencies?: unknown };
      expect(pkg.scripts.dev).toBe('node server.cjs');
      expect(pkg.dependencies).toBeUndefined();
      expect(execFileSync(process.execPath, ['--test', '--test-reporter=tap', 'tests/search.test.cjs'], { cwd: dir, encoding: 'utf8' })).toContain('# pass 2');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
