#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MODES = {
  full: 'docs/evidence/fallow-dead-code-baseline.json',
  production: 'docs/evidence/fallow-production-dead-code-baseline.json',
};

function validateBaseline(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !['unused_files', 'unused_exports', 'unused_types'].every((key) => Object.hasOwn(value, key))) {
    throw new Error(`${label}: invalid Fallow identity baseline`);
  }
  for (const [category, identities] of Object.entries(value)) {
    if (!Array.isArray(identities) || identities.some((id) => typeof id !== 'string' || !id.trim())
      || new Set(identities).size !== identities.length) {
      throw new Error(`${label}: invalid or duplicate identities in ${category}`);
    }
  }
}

/** Compare Fallow's own serialized identities, not counts or source locations. */
function compareBaselines(accepted, current) {
  validateBaseline(accepted, 'Accepted baseline');
  validateBaseline(current, 'Current scan');
  const added = [];
  const stale = [];
  for (const category of new Set([...Object.keys(accepted), ...Object.keys(current)])) {
    const previous = new Set(accepted[category] ?? []);
    const fresh = new Set(current[category] ?? []);
    for (const id of fresh) if (!previous.has(id)) added.push(`${category}: ${id}`);
    for (const id of previous) if (!fresh.has(id)) stale.push(`${category}: ${id}`);
  }
  return { added: added.sort(), stale: stale.sort() };
}

function readScan(result, snapshotPath) {
  if (result.error || result.signal || ![0, 1].includes(result.status)) {
    throw new Error(`Fallow scan failed: ${result.error?.message || result.signal || result.stderr || result.status}`);
  }
  const report = JSON.parse(result.stdout);
  // Exit 1 is expected for a successful scan with findings, not for tool errors.
  if (report.schema_version !== 4 || !Number.isSafeInteger(report.total_issues) || report.total_issues < 0
    || result.status !== (report.total_issues > 0 ? 1 : 0)) {
    throw new Error('Fallow returned an invalid report or unexpected exit status; recheck compatibility');
  }
  const current = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  validateBaseline(current, 'Current scan');
  const savedCount = Object.values(current).reduce((total, identities) => total + identities.length, 0);
  if (savedCount !== report.total_issues) {
    throw new Error('Fallow report/snapshot mismatch; recheck identity serialization compatibility');
  }
  return current;
}

function checkMode(mode) {
  const baselinePath = MODES[mode];
  const accepted = JSON.parse(readFileSync(path.join(ROOT, baselinePath), 'utf8'));
  validateBaseline(accepted, baselinePath);
  const temporary = mkdtempSync(path.join(tmpdir(), 'clanker-fallow-'));
  try {
    const snapshotPath = path.join(temporary, 'identities.json');
    const args = [require.resolve('fallow/bin/fallow'), 'dead-code', '--no-cache', '--format', 'json',
      '--save-baseline', snapshotPath, ...(mode === 'production' ? ['--production'] : [])];
    const result = spawnSync(process.execPath, args, {
      cwd: ROOT, encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1024 * 1024,
    });
    const { added, stale } = compareBaselines(accepted, readScan(result, snapshotPath));
    if (added.length) console.error(`[${mode}] New findings (review; do not blindly regenerate):\n${added.join('\n')}`);
    if (stale.length) console.error(`[${mode}] Stale exemptions (remove from ${baselinePath}):\n${stale.join('\n')}`);
    if (added.length || stale.length) return false;
    console.log(`[${mode}] Fallow identity baseline matches; no new findings or stale exemptions.`);
    return true;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function main(args) {
  const modes = args.length === 0 ? Object.keys(MODES)
    : args.length === 1 && ['--full', '--production'].includes(args[0]) ? [args[0].slice(2)] : null;
  if (!modes) throw new Error('Usage: node scripts/check-fallow.cjs [--full|--production]');
  let passed = true;
  for (const mode of modes) if (!checkMode(mode)) passed = false;
  return passed ? 0 : 1;
}

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { compareBaselines, readScan };
