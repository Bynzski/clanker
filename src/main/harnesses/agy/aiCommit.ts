import { HarnessCapabilityError, type HarnessAiCommitCapability } from '../types';

/** Stream input avoids putting Git content through cmd.exe argument quoting or
 * command-line size limits. EOF closes the single-turn stream. */
export const aiCommit: HarnessAiCommitCapability = {
  modelArg: '--model',
  buildInvocation: ({ model, prompt }) => ({
    command: 'agy',
    args: ['--disable-slash-commands', ...(model ? ['--model', model] : []), '--input-format', 'stream-json', '--output-format', 'stream-json'],
    stdin: JSON.stringify({ event: 'user', message: { content: prompt } }),
    timeoutMs: 60000,
  }),
  parseOutput(output) {
    try {
      const events: unknown[] = output.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
      const results = events.filter((event): event is { event: string; result: { status: string; response: string } } =>
        typeof event === 'object' && event !== null && 'event' in event && event.event === 'result');
      if (results.length !== 1 || results[0].result?.status !== 'SUCCESS' || typeof results[0].result.response !== 'string') {
        throw new Error('Expected one successful Antigravity result');
      }
      return results[0].result.response;
    } catch (error) {
      throw new HarnessCapabilityError('parse-failure', 'Invalid Antigravity AI commit response', error);
    }
  },
};
