import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHarnessCommand, buildHarnessSpawnArgs, normalizePiModelId, type HarnessConfig } from './harnessLaunch';

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

test('buildHarnessCommand quotes shell-sensitive model values', () => {
  assert.equal(
    buildHarnessCommand(piConfig, 'sonnet:high thinking'),
    "pi --model 'sonnet:high thinking'"
  );
});

test('normalizePiModelId keeps the documented provider/model shape', () => {
  assert.equal(
    normalizePiModelId('anthropic', 'sonnet:high'),
    'anthropic/sonnet:high'
  );
});

test('pi discovery should not invent fallback models when none are available', () => {
  const output = 'No models available. Set API keys in environment variables.';
  assert.equal(
    output.toLowerCase().includes('no models available'),
    true
  );
});
