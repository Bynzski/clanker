import { expect, it } from 'vitest';
import { AI_COMMIT_COMMANDS, getAiCommitTimeoutMs } from '../../../src/main/aiCommit';
import { getHarnessProvider } from '../../../src/main/harnesses/registry';

it.each([
  ['codex', ['exec', '-m', 'model'], 'stdin', 60000],
  ['opencode', ['run', '-m', 'model'], 'stdin', 90000],
  ['pi', ['--print', '--model', 'model'], 'stdin', 45000],
  ['omp', ['--print', '--no-session', '--no-tools', '--no-extensions', '--model', 'model'], 'stdin', 60000],

] as const)('%s owns its prompt transport and noninteractive invocation', (id, args, transport, timeoutMs) => {
  const capability = getHarnessProvider(id).aiCommit;
  expect(capability.buildInvocation({ model: 'model', prompt: 'prompt\nwith context' })).toEqual({
    command: id, args: [...args], timeoutMs,
    ...(transport === 'stdin' ? { stdin: 'prompt\nwith context' } : {}),
  });
  expect(capability.buildInvocation({ prompt: 'prompt' }).args).not.toContain('model');
});

it('Agy streams one JSON prompt without putting Git content in arguments', () => {
  const capability = getHarnessProvider('agy').aiCommit;
  const prompt = '"quoted" & shell | content\n' + 'x'.repeat(40000);
  expect(capability.buildInvocation({ model: 'model', prompt })).toEqual({
    command: 'agy', args: ['--disable-slash-commands', '--model', 'model', '--input-format', 'stream-json', '--output-format', 'stream-json'],
    stdin: JSON.stringify({ event: 'user', message: { content: prompt } }), timeoutMs: 60000,
  });
  expect(capability.parseOutput!(JSON.stringify({ event: 'init' }) + '\n' + JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'fix: example' } }))).toBe('fix: example');
  for (const output of ['', '{', '{}', '{"event":"result","result":{"status":"ERROR"}}']) {
    expect(() => capability.parseOutput!(output)).toThrow(expect.objectContaining({ kind: 'parse-failure' }));
  }
});

it.each(['codex', 'opencode', 'pi', 'omp', 'agy'] as const)('%s legacy metadata is derived from canonical invocation', (id) => {
  const capability = getHarnessProvider(id).aiCommit;
  const invocation = capability.buildInvocation({ prompt: '' });
  expect(AI_COMMIT_COMMANDS[id]).toEqual({ command: invocation.command, args: invocation.args, modelArg: capability.modelArg });
  expect(getAiCommitTimeoutMs(id)).toBe(invocation.timeoutMs);
  const modeled = capability.buildInvocation({ prompt: '', model: 'selected-model' });
  expect(modeled.args[modeled.args.indexOf('selected-model') - 1]).toBe(capability.modelArg);
});
