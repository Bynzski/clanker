// Release security gate: `npm audit` at the high threshold, with one narrow, documented exception.
//
// Why an exception exists: GHSA-ch52-4w7c-c8xp (http-cache-semantics <= 4.2.0) has no patched
// release, and every current electron-builder v26 (through 26.17.0) pulls it in via
// app-builder-lib -> @electron/get@3 -> got@11 -> cacheable-request. npm's suggested fix is to
// downgrade to electron-builder 26.5.0, which reintroduces GHSA-7g7r-gx96-252g (AppImage) and
// GHSA-p2f4-r6v6-j797 (builder-util-runtime). So the exception below is pinned to the exact
// advisory and dev-only dependency chain, and the builder version floors are enforced.
//
// REMOVE the exception (and this script, restoring `npm audit --audit-level=high`) once npm audit
// reports no high findings for this chain; the script prints a notice when that happens.
// See RELEASING.md "Security gate".
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const FAIL_SEVERITIES = new Set(['high', 'critical']);
const EXCEPTION_ADVISORY = 'GHSA-ch52-4w7c-c8xp';
const EXCEPTION_ROOT = 'electron-builder';
// Every package npm reports as affected through the single advisory above.
const EXCEPTION_PACKAGES = new Set([
  'http-cache-semantics',
  'cacheable-request',
  'got',
  '@electron/get',
  'app-builder-lib',
  'dmg-builder',
  'electron-builder-squirrel-windows',
  'electron-builder',
]);
// Floors that npm's suggested "fix" (electron-builder 26.5.0) would violate.
const VERSION_FLOORS = {
  'node_modules/app-builder-lib': [26, 15, 0], // GHSA-7g7r-gx96-252g (AppImage)
  'node_modules/electron-builder': [26, 15, 0],
  'node_modules/builder-util-runtime': [9, 7, 0], // GHSA-p2f4-r6v6-j797
};

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version ?? '');
  return match ? match.slice(1).map(Number) : null;
}

function atLeast(version, floor) {
  const parsed = parseVersion(version);
  if (!parsed) return false;
  for (let i = 0; i < 3; i += 1) {
    if (parsed[i] !== floor[i]) return parsed[i] > floor[i];
  }
  return true;
}

function advisoryId(url) {
  return typeof url === 'string' ? url.split('/').pop() : undefined;
}

// Returns { failures, allowed } for a parsed `npm audit --json` report.
function evaluateAudit(report, lockfile, packageJson) {
  const failures = [];
  if (!report || typeof report !== 'object' || report.error || !report.vulnerabilities) {
    const detail = report?.error?.summary ?? report?.error?.code ?? 'unrecognised npm audit output';
    return { failures: [`npm audit did not produce a usable report: ${detail}`], allowed: [] };
  }

  const blocking = Object.values(report.vulnerabilities)
    .filter((entry) => FAIL_SEVERITIES.has(entry.severity));
  const allowed = [];
  const packages = lockfile?.packages ?? {};

  for (const entry of blocking) {
    const reasons = [];
    if (!EXCEPTION_PACKAGES.has(entry.name)) reasons.push('package is not part of the allowed chain');
    for (const via of entry.via ?? []) {
      if (typeof via === 'string') {
        if (!EXCEPTION_PACKAGES.has(via)) reasons.push(`affected through unexpected package ${via}`);
      } else if (advisoryId(via.url) !== EXCEPTION_ADVISORY) {
        reasons.push(`advisory ${advisoryId(via.url) ?? via.title} is not the allowed advisory`);
      }
    }
    for (const node of entry.nodes ?? []) {
      if (!packages[node]) reasons.push(`${node} is missing from package-lock.json`);
      else if (packages[node].dev !== true) reasons.push(`${node} is not dev-only (runtime dependency)`);
    }
    if (reasons.length) failures.push(`${entry.name} (${entry.severity}): ${reasons.join('; ')}`);
    else allowed.push(entry.name);
  }

  if (allowed.length && (!packageJson?.devDependencies?.[EXCEPTION_ROOT] || packageJson?.dependencies?.[EXCEPTION_ROOT])) {
    failures.push(`${EXCEPTION_ROOT} must stay a devDependency to use the audit exception`);
  }
  // Always enforced: a downgrade must not be able to "clear" the audit by dropping the fixes.
  for (const [node, floor] of Object.entries(VERSION_FLOORS)) {
    const version = packages[node]?.version;
    if (!atLeast(version, floor)) failures.push(`${node}@${version ?? 'missing'} is below required ${floor.join('.')}`);
  }
  return { failures, allowed };
}

function runAudit() {
  const result = spawnSync('npm', ['audit', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return { error: { summary: (result.stderr || result.stdout || 'empty output').trim().slice(0, 500) } };
  }
}

function main() {
  const root = path.join(__dirname, '..');
  const readJson = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  const { failures, allowed } = evaluateAudit(runAudit(), readJson('package-lock.json'), readJson('package.json'));
  if (failures.length) {
    console.error('Security check failed:');
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error('Run `npm audit` for details. Only the exact exception in scripts/security-audit.cjs is permitted.');
    process.exitCode = 1;
    return;
  }
  if (allowed.length) {
    console.warn(`Security check passed with a temporary exception for ${EXCEPTION_ADVISORY} `
      + `(dev-only ${EXCEPTION_ROOT} chain: ${allowed.sort().join(', ')}).`);
    console.warn('No other high/critical advisories. See RELEASING.md "Security gate" for the removal condition.');
  } else {
    console.log(`Security check passed: no high/critical advisories. The ${EXCEPTION_ADVISORY} exception `
      + 'is no longer needed; remove it from scripts/security-audit.cjs.');
  }
}

module.exports = { evaluateAudit, EXCEPTION_ADVISORY };

if (require.main === module) main();
