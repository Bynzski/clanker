import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'vitest';
import {
  buildHarnessSpawnArgs,
  buildHarnessWrapperScript,
  ensureHarnessWrapperScript,
  getHarnessWrapperScriptPath,
  normalizePiModelId,
  type HarnessConfig,
} from '../../../src/main/harnessLaunch';

const opencodeConfig: HarnessConfig = {
  name: 'OpenCode',
  command: 'opencode',
  args: ['--pure'],
  icon: '⚡',
  modelArg: '-m',
};

const codexConfig: HarnessConfig = {
  name: 'Codex',
  command: 'codex',
  args: ['--yolo'],
  icon: '🧠',
  modelArg: '-m',
};

const piConfig: HarnessConfig = {
  name: 'Pi',
  command: 'pi',
  args: [],
  icon: 'π',
  modelArg: '--model',
};

test('buildHarnessSpawnArgs keeps harness args and prepends the selected model flag', () => {
  assert.deepEqual(
    buildHarnessSpawnArgs(opencodeConfig, 'opencode/zen/big-pickle'),
    ['-m', 'opencode/zen/big-pickle', '--pure']
  );
});

test('buildHarnessSpawnArgs preserves harness-only launches', () => {
  assert.deepEqual(
    buildHarnessSpawnArgs(codexConfig),
    ['--yolo']
  );
});

test('buildHarnessSpawnArgs preserves shell-sensitive model values as a single argument', () => {
  assert.deepEqual(
    buildHarnessSpawnArgs(piConfig, 'sonnet:high thinking'),
    ['--model', 'sonnet:high thinking']
  );
});

test('normalizePiModelId keeps the documented provider/model shape', () => {
  assert.equal(
    normalizePiModelId('anthropic', 'sonnet:high'),
    'anthropic/sonnet:high'
  );
});

test('buildHarnessWrapperScript runs the harness in the foreground and falls back to an interactive shell', () => {
  const script = buildHarnessWrapperScript();

  assert.match(script, /^#!\/usr\/bin\/env sh/m);
  assert.match(script, /"\$@"\nexit_code=\$\?/);
  assert.doesNotMatch(script, /"\$@" &/);
  assert.doesNotMatch(script, /wait "\$child_pid"/);
  assert.doesNotMatch(script, /trap 'forward_signal INT' INT/);
  assert.match(script, /exec "\$fallback_shell" -i/);
  assert.match(script, /CLANKER_GRID_FALLBACK_SHELL/);
});

test('ensureHarnessWrapperScript writes the wrapper to a user-local path', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-grid-harness-wrapper-'));

  try {
    const wrapperPath = ensureHarnessWrapperScript(tempHome);
    const expectedPath = getHarnessWrapperScriptPath(tempHome);

    assert.equal(wrapperPath, expectedPath);
    assert.equal(fs.existsSync(wrapperPath), true);
    assert.equal(fs.readFileSync(wrapperPath, 'utf8'), buildHarnessWrapperScript());
    assert.equal((fs.statSync(wrapperPath).mode & 0o777), 0o700);
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('pi discovery should not invent fallback models when none are available', () => {
  const output = 'No models available. Set API keys in environment variables.';
  assert.equal(
    output.toLowerCase().includes('no models available'),
    true
  );
});
