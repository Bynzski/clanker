import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const workflow = readFileSync(resolve('.github/workflows/validate.yml'), 'utf8');
const gateJob = workflow.split(/^ {2}validate:\s*$/m)[1];
const script = gateJob?.match(/^ {8}run: \|\n((?: {10}.*\n?)+)/m)?.[1].replace(/^ {10}/gm, '');

// The production gate runs in Bash on Ubuntu. These tests execute that exact inline
// script, rather than duplicating its policy; native Windows need not supply Bash.
describe.skipIf(process.platform === 'win32')('canonical CI aggregate gate', () => {
  it.each([
    { changes: 'success', code: 'true', ubuntu: 'success', pass: true },
    { changes: 'success', code: 'true', ubuntu: 'failure', pass: false },
    { changes: 'success', code: 'true', ubuntu: 'cancelled', pass: false },
    { changes: 'success', code: 'true', ubuntu: 'skipped', pass: false },
    { changes: 'success', code: 'false', ubuntu: 'skipped', pass: true },
    { changes: 'success', code: 'false', ubuntu: 'success', pass: false },
    { changes: 'success', code: 'false', ubuntu: 'failure', pass: false },
    { changes: 'success', code: 'false', ubuntu: 'cancelled', pass: false },
    { changes: 'failure', code: 'true', ubuntu: 'success', pass: false },
    { changes: 'cancelled', code: 'false', ubuntu: 'skipped', pass: false },
    { changes: 'skipped', code: 'false', ubuntu: 'skipped', pass: false },
    { changes: 'success', code: '', ubuntu: 'skipped', pass: false },
    { changes: 'success', code: 'unknown', ubuntu: 'skipped', pass: false },
  ])('changes=$changes code=$code ubuntu=$ubuntu => pass=$pass', ({ changes, code, ubuntu, pass }) => {
    expect(script).toBeTruthy();
    const result = spawnSync('bash', ['-c', script!], {
      env: { ...process.env, CHANGES: changes, CODE_CHANGED: code, UBUNTU: ubuntu, WINDOWS: 'failure' },
      encoding: 'utf8', timeout: 5000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(pass ? 0 : 1);
  });
});

it('keeps the stable Ubuntu-only check and full compatibility suite', () => {
  expect(gateJob).toMatch(/^ {4}needs: \[changes, ubuntu-validation\]$/m);
  expect(gateJob).toMatch(/^ {4}if: always\(\)$/m);
  expect(workflow).not.toMatch(/windows-compat|windows-latest|needs\.windows|\$WINDOWS/);
  expect(workflow).toContain('run: npm run test:coverage');
  expect(workflow).not.toContain('--project main');
  expect(workflow).toContain('branches: [main]');
});
