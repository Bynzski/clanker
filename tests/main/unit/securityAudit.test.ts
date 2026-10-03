import { describe, expect, test } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { evaluateAudit } = require('../../../scripts/security-audit.cjs') as {
  evaluateAudit: (report: unknown, lockfile: unknown, packageJson: unknown) => { failures: string[]; allowed: string[] };
};

const ADVISORY = 'https://github.com/advisories/GHSA-ch52-4w7c-c8xp';
const packageJson = { devDependencies: { 'electron-builder': '^26.15.3' } };
const lockfile = () => ({
  packages: {
    'node_modules/http-cache-semantics': { version: '4.2.0', dev: true },
    'node_modules/got': { version: '11.8.6', dev: true },
    'node_modules/app-builder-lib': { version: '26.15.3', dev: true },
    'node_modules/electron-builder': { version: '26.15.3', dev: true },
    'node_modules/builder-util-runtime': { version: '9.7.0', dev: true },
  },
});
const knownReport = () => ({
  vulnerabilities: {
    'http-cache-semantics': {
      name: 'http-cache-semantics', severity: 'high', via: [{ url: ADVISORY }],
      nodes: ['node_modules/http-cache-semantics'],
    },
    got: { name: 'got', severity: 'high', via: ['http-cache-semantics'], nodes: ['node_modules/got'] },
    'electron-builder': {
      name: 'electron-builder', severity: 'high', via: ['app-builder-lib'], nodes: ['node_modules/electron-builder'],
    },
  },
});

describe('security audit policy', () => {
  test('permits only the known dev-only electron-builder chain', () => {
    const result = evaluateAudit(knownReport(), lockfile(), packageJson);
    expect(result.failures).toEqual([]);
    expect(result.allowed.sort()).toEqual(['electron-builder', 'got', 'http-cache-semantics']);
  });

  test('passes a clean report', () => {
    expect(evaluateAudit({ vulnerabilities: {} }, lockfile(), packageJson))
      .toEqual({ failures: [], allowed: [] });
  });

  test('fails on a different advisory in an allowed package', () => {
    const report = knownReport();
    report.vulnerabilities.got.via = [{ url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc' }] as never;
    expect(evaluateAudit(report, lockfile(), packageJson).failures[0]).toMatch(/got.*GHSA-aaaa-bbbb-cccc/);
  });

  test('fails on any other high or critical package', () => {
    const report = knownReport();
    (report.vulnerabilities as Record<string, unknown>).lodash = {
      name: 'lodash', severity: 'critical', via: [{ url: 'https://github.com/advisories/GHSA-xxxx-yyyy-zzzz' }],
      nodes: ['node_modules/lodash'],
    };
    expect(evaluateAudit(report, lockfile(), packageJson).failures.join('\n')).toMatch(/lodash/);
  });

  test('ignores moderate findings but not the exception chain in runtime dependencies', () => {
    const report = knownReport();
    (report.vulnerabilities as Record<string, unknown>).minimist = { name: 'minimist', severity: 'moderate', via: [], nodes: [] };
    expect(evaluateAudit(report, lockfile(), packageJson).failures).toEqual([]);
    const runtime = lockfile();
    delete (runtime.packages['node_modules/got'] as { dev?: boolean }).dev;
    expect(evaluateAudit(knownReport(), runtime, packageJson).failures.join('\n')).toMatch(/not dev-only/);
  });

  test('fails when electron-builder moves out of devDependencies', () => {
    const failures = evaluateAudit(knownReport(), lockfile(), { dependencies: { 'electron-builder': '^26.15.3' } }).failures;
    expect(failures.join('\n')).toMatch(/must stay a devDependency/);
  });

  test.each([
    ['node_modules/app-builder-lib', '26.5.0'],
    ['node_modules/electron-builder', '26.5.0'],
    ['node_modules/builder-util-runtime', '9.6.0'],
  ])('fails when %s drops below the AppImage/runtime security fix (%s)', (node, version) => {
    const lock = lockfile();
    (lock.packages as Record<string, { version: string }>)[node].version = version;
    // Enforced even when the audit itself is clean, so a downgrade cannot silence it.
    expect(evaluateAudit({ vulnerabilities: {} }, lock, packageJson).failures.join('\n')).toMatch(/below required/);
  });

  test('fails closed when npm audit cannot produce a report', () => {
    expect(evaluateAudit({ error: { summary: 'getaddrinfo ENOTFOUND' } }, lockfile(), packageJson).failures[0])
      .toMatch(/ENOTFOUND/);
    expect(evaluateAudit(null, lockfile(), packageJson).failures).toHaveLength(1);
  });
});
