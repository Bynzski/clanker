import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
type Baseline = Record<string, string[]>;
type ScanResult = { status: number | null; stdout: string; stderr?: string; signal?: string | null; error?: Error };
const { compareBaselines, readScan } = require('../../../scripts/check-fallow.cjs') as {
  compareBaselines: (accepted: unknown, current: unknown) => { added: string[]; stale: string[] };
  readScan: (result: ScanResult, snapshotPath: string) => Baseline;
};
const baseline = (exports: string[] = []): Baseline => ({ unused_files: [], unused_exports: exports, unused_types: [] });

describe('Fallow identity gate', () => {
  it.skipIf(process.platform === 'win32')('validates baseline-only PRs but still skips ordinary documentation', () => {
    const workflow = readFileSync(path.resolve('.github/workflows/validate.yml'), 'utf8');
    const detection = workflow.match(/ {10}# Fallow baselines[\s\S]*?(?= {10}if \[ -n "\$non_docs" \])/);
    expect(detection).not.toBeNull();
    const classify = (files: string) => execFileSync('bash', ['-c',
      `set -euo pipefail\nfiles="$1"\n${detection![0]}\nif [ -n "$non_docs" ]; then echo code; else echo docs; fi`,
      'check', files], { encoding: 'utf8' }).trim();
    expect(classify('docs/fallow.md\nAGENTS.md')).toBe('docs');
    expect(classify('docs/evidence/fallow-dead-code-baseline.json')).toBe('code');
    expect(classify('docs/evidence/fallow-production-dead-code-baseline.json')).toBe('code');
    expect(classify('docs/fallow.md\nsrc/shared/keybindings.ts')).toBe('code');
  });

  it('passes the same identities independent of ordering', () => {
    expect(compareBaselines(baseline(['a:x', 'b:y']), baseline(['b:y', 'a:x'])))
      .toEqual({ added: [], stale: [] });
  });

  it('rejects a replacement even when the issue count is unchanged', () => {
    expect(compareBaselines(baseline(['a:x']), baseline(['b:y'])))
      .toEqual({ added: ['unused_exports: b:y'], stale: ['unused_exports: a:x'] });
  });

  it('rejects stale exemptions and category changes', () => {
    expect(compareBaselines(baseline(['a:x']), baseline()).stale).toEqual(['unused_exports: a:x']);
    const current = { ...baseline(), unused_types: ['a:x'] };
    expect(compareBaselines(baseline(['a:x']), current).added).toEqual(['unused_types: a:x']);
  });

  it('covers all native categories, including newly introduced ones', () => {
    expect(compareBaselines(baseline(), { ...baseline(), boundary_violations: ['renderer->main'] }).added)
      .toEqual(['boundary_violations: renderer->main']);
    expect(compareBaselines({ ...baseline(), unresolved_imports: ['src/a.ts:x'] }, baseline()).stale)
      .toEqual(['unresolved_imports: src/a.ts:x']);
  });

  it.each([null, [], {}, { ...baseline(), unused_exports: 'x' }, baseline(['']), baseline(['a:x', 'a:x'])])(
    'fails closed on malformed baseline %#', (invalid) => {
      expect(() => compareBaselines(invalid, baseline())).toThrow(/invalid|duplicate/);
      expect(() => compareBaselines(baseline(), invalid)).toThrow(/invalid|duplicate/);
    },
  );

  it('does not mutate either accepted or current baseline', () => {
    const accepted = baseline(['a:x']); const current = baseline(['b:y']);
    compareBaselines(accepted, current);
    expect(accepted).toEqual(baseline(['a:x'])); expect(current).toEqual(baseline(['b:y']));
  });

  it('accepts exit 1 only with a valid completed scan and snapshot', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'fallow-test-'));
    const snapshot = path.join(directory, 'snapshot.json');
    const findings = baseline(['a:x']);
    const result = { status: 1, stdout: JSON.stringify({ schema_version: 4, total_issues: 1 }) };
    try {
      writeFileSync(snapshot, JSON.stringify(findings));
      expect(readScan(result, snapshot)).toEqual(findings);
      expect(readFileSync(snapshot, 'utf8')).toBe(JSON.stringify(findings));
      expect(() => readScan({ ...result, status: 2 }, snapshot)).toThrow(/failed/);
      expect(() => readScan({ ...result, status: null, signal: 'SIGTERM' }, snapshot)).toThrow(/failed/);
      expect(() => readScan({ ...result, error: new Error('ENOENT') }, snapshot)).toThrow(/ENOENT/);
      expect(() => readScan({ ...result, stdout: 'not JSON' }, snapshot)).toThrow();
      expect(() => readScan({ ...result, stdout: '{}' }, snapshot)).toThrow(/invalid report/);
      expect(() => readScan({ ...result, status: 0 }, snapshot)).toThrow(/unexpected exit/);
      expect(() => readScan({ ...result, stdout: JSON.stringify({ schema_version: 5, total_issues: 1 }) }, snapshot))
        .toThrow(/compatibility/);
      writeFileSync(snapshot, JSON.stringify(baseline()));
      expect(() => readScan(result, snapshot)).toThrow(/report\/snapshot mismatch/);
      writeFileSync(snapshot, '{}');
      expect(() => readScan(result, snapshot)).toThrow(/invalid/);
      rmSync(snapshot);
      expect(() => readScan(result, snapshot)).toThrow(/ENOENT/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('accepts a clean successful scan', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'fallow-test-'));
    const snapshot = path.join(directory, 'snapshot.json');
    try {
      writeFileSync(snapshot, JSON.stringify(baseline()));
      expect(readScan({ status: 0, stdout: JSON.stringify({ schema_version: 4, total_issues: 0 }) }, snapshot))
        .toEqual(baseline());
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
