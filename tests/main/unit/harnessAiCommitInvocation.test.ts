import { expect, it } from 'vitest';
import { getHarnessProvider } from '../../../src/main/harnesses/registry';

it.each([
  ['codex', ['exec', '-m', 'model'], 'stdin', 60000],
  ['opencode', ['run', '-m', 'model'], 'stdin', 90000],
  ['pi', ['--print', '--model', 'model'], 'stdin', 45000],
  ['omp', ['--print', '--no-session', '--no-tools', '--no-extensions', '--model', 'model'], 'stdin', 60000],
  ['agy', ['--disable-slash-commands', '--model', 'model', '--print', 'prompt\nwith context'], 'argument', 60000],
] as const)('%s owns its prompt transport and noninteractive invocation', (id, args, transport, timeoutMs) => {
  const capability = getHarnessProvider(id).aiCommit;
  expect(capability.buildInvocation({ model: 'model', prompt: 'prompt\nwith context' })).toEqual({
    command: id, args: [...args], timeoutMs,
    ...(transport === 'stdin' ? { stdin: 'prompt\nwith context' } : {}),
  });
  expect(capability.buildInvocation({ prompt: 'prompt' }).args).not.toContain('model');
});
