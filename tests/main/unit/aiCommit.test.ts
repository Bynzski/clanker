import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  AI_COMMIT_COMMANDS,
  buildAiCommitArgs,
  buildCommitPrompt,
  getAiCommitTimeoutMs,
  normalizeCommitMessageOutput,
} from '../../../src/main/aiCommit';

test('buildAiCommitArgs keeps codex exec and prepends the selected model flag', () => {
  assert.deepEqual(
    buildAiCommitArgs('codex', 'gpt-5.4-mini'),
    ['exec', '-m', 'gpt-5.4-mini']
  );
});

test('buildAiCommitArgs preserves opencode prompt-only launches when no model is provided', () => {
  assert.deepEqual(
    buildAiCommitArgs('opencode', undefined),
    []
  );
});

test('buildCommitPrompt includes repository context and change summary', () => {
  const prompt = buildCommitPrompt({
    workspacePath: '/repo',
    branchName: 'main',
    isDetached: false,
    changeSummary: ['staged modified: src/app.ts', 'unstaged added: README.md'],
    diffMode: 'staged',
    diffSummary: '2 files changed, 14 insertions(+), 3 deletions(-)',
  });

  assert.match(prompt, /Repository: \/repo/);
  assert.match(prompt, /Branch: main/);
  assert.match(prompt, /staged modified: src\/app\.ts/);
  assert.match(prompt, /Format: feature: \.\.\., fix: \.\.\., restructure: \.\.\., or chore: \.\.\./);
});

test('normalizeCommitMessageOutput strips fences and labels', () => {
  const message = normalizeCommitMessageOutput('```text\nCommit message: feat: add commit helper\n```');
  assert.equal(message, 'feat: add commit helper');
});

test('AI commit command map includes the documented CLIs', () => {
  assert.equal(AI_COMMIT_COMMANDS.codex.command, 'codex');
  assert.equal(AI_COMMIT_COMMANDS.opencode.modelArg, '-m');
  assert.equal(AI_COMMIT_COMMANDS.pi.modelArg, '--model');
});

test('opencode gets a longer timeout than the other providers', () => {
  assert.equal(getAiCommitTimeoutMs('opencode'), 90000);
  assert.equal(getAiCommitTimeoutMs('codex'), 60000);
  assert.equal(getAiCommitTimeoutMs('pi'), 45000);
});
