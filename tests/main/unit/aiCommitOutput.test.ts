import { describe, expect, it } from 'vitest';
import { getHarnessProvider } from '../../../src/main/harnesses/registry';

const jsonl = (...events: unknown[]) => events.map((event) => JSON.stringify(event)).join('\n');
const finalText = 'fix: use the completed assistant response\n\nKeep reasoning out of commit drafts.';

describe('AI commit native output contracts', () => {
  it('Codex ignores reasoning and selects the last completed agent message', () => {
    const parse = getHarnessProvider('codex').aiCommit.parseOutput;
    expect(parse(jsonl(
      { type: 'turn.started' },
      { type: 'item.completed', item: { type: 'reasoning', text: 'Let me think first' } },
      { type: 'item.completed', item: { type: 'agent_message', text: 'Inspecting the changes' } },
      { type: 'item.completed', item: { type: 'agent_message', text: finalText } },
      { type: 'turn.completed' },
    ))).toBe(finalText);
    for (const output of [
      jsonl({ type: 'item.completed', item: { type: 'reasoning', text: 'fix: not an answer' } }, { type: 'turn.completed' }),
      jsonl({ type: 'item.completed', item: { type: 'agent_message', channel: 'analysis', text: 'fix: private thought' } }, { type: 'turn.completed' }),
      jsonl({ type: 'item.completed', item: { type: 'agent_message', text: finalText } }),
      jsonl({ type: 'item.completed', item: { type: 'agent_message', text: finalText } }, { type: 'turn.failed' }),
    ]) expect(() => parse(output)).toThrow(expect.objectContaining({ kind: 'parse-failure' }));
  });

  it('OpenCode selects text from the final completed step, not reasoning or tool steps', () => {
    const parse = getHarnessProvider('opencode').aiCommit.parseOutput;
    expect(parse(jsonl(
      { type: 'step_start' },
      { type: 'reasoning', part: { text: 'First thinking trace' } },
      { type: 'text', part: { text: 'Earlier tool commentary' } },
      { type: 'step_finish', part: { reason: 'tool-calls' } },
      { type: 'step_start' },
      { type: 'text', part: { synthetic: true, text: 'Injected instruction' } },
      { type: 'text', part: { text: finalText } },
      { type: 'step_finish', part: { reason: 'stop' } },
    ))).toBe(finalText);
    for (const reason of ['tool-calls', 'length', 'error']) {
      expect(() => parse(jsonl({ type: 'text', part: { text: finalText } }, { type: 'step_finish', part: { reason } }))).toThrow();
    }
    expect(() => parse(jsonl({ type: 'text', part: { text: finalText } }, { type: 'error' }))).toThrow();
  });

  it.each(['pi', 'omp'] as const)('%s uses completed assistant text blocks only', (id) => {
    const parse = getHarnessProvider(id).aiCommit.parseOutput;
    const message = { role: 'assistant', stopReason: 'stop', content: [
      { type: 'thinking', thinking: 'First thinking trace' }, { type: 'text', text: finalText },
    ] };
    expect(parse(jsonl(
      { type: 'message_end', message: { role: 'user', content: 'prompt' } },
      { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'reasoning' } },
      { type: 'message_end', message },
      { type: 'agent_end' },
    ))).toBe(finalText);
    for (const stopReason of ['error', 'aborted', 'length', 'toolUse']) {
      expect(() => parse(jsonl({ type: 'message_end', message }, { type: 'message_end', message: { ...message, stopReason } }))).toThrow();
    }
    expect(() => parse(jsonl({ type: 'message_end', message: { ...message, content: [{ type: 'thinking', thinking: 'fix: private thought' }] } }))).toThrow();
    expect(() => parse(jsonl({ type: 'message_end', message }, { type: 'agent_settled', aborted: true }))).toThrow();
    expect(() => parse(jsonl({ type: 'message_end', message }, { type: 'message_start', message: { role: 'assistant', content: [] } }))).toThrow();
  });

  it.each(['codex', 'opencode', 'pi', 'omp', 'agy'] as const)('%s fails closed on decorated, malformed, or empty stdout', (id) => {
    const parse = getHarnessProvider(id).aiCommit.parseOutput;
    for (const output of ['', 'Thinking…\nfix: guessing', 'fix: plaintext', '{}', '{']) {
      expect(() => parse(output)).toThrow(expect.objectContaining({ kind: 'parse-failure' }));
    }
  });
});
