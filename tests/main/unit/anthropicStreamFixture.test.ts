import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

interface Block { type: 'text' | 'tool_use'; text?: string; id?: string; name?: string; input?: Record<string, unknown> }
interface Frame {
  type: string;
  index?: number;
  message?: { id: string; model: string; usage: { input_tokens: number } };
  content_block?: Record<string, unknown>;
  delta?: Record<string, unknown>;
}
const require = createRequire(import.meta.url);
const { anthropicStream } = require('../../../scripts/lib/anthropic-stream-fixture.cjs') as {
  anthropicStream(input: { id: string; model?: string; content?: Block[]; inputTokens?: number }): string;
};
const frames = (input: Parameters<typeof anthropicStream>[0]): Frame[] => anthropicStream(input).trim().split('\n\n').map(frame => {
  const [event, data] = frame.split('\n');
  const value = JSON.parse(data.slice('data: '.length)) as Frame;
  expect(event).toBe(`event: ${value.type}`);
  return value;
});

describe('native Claude deterministic SSE fixture', () => {
  it('emits a complete text message with matching SSE and payload event names', () => {
    const events = frames({ id: 'msg_fixture' });
    expect(events.map(event => event.type)).toEqual(['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
    expect(events[0].message).toMatchObject({ id: 'msg_fixture', model: 'claude-haiku-4-5', usage: { input_tokens: 1000 } });
    expect(events[2].delta).toEqual({ type: 'text_delta', text: 'ok' });
    expect(events[4].delta).toMatchObject({ stop_reason: 'end_turn' });
  });

  it('streams native tool JSON without splitting escaped input across SSE frames', () => {
    const input = { command: 'printf "fixture\\n"', description: 'Unicode fixture: ✓' };
    const events = frames({ id: 'msg_tool', content: [{ type: 'tool_use', id: 'tool_fixture', name: 'Bash', input }] });
    expect(events[1].content_block).toEqual({ type: 'tool_use', id: 'tool_fixture', name: 'Bash', input: {} });
    expect(JSON.parse(String(events[2].delta?.partial_json))).toEqual(input);
    expect(events[4].delta).toMatchObject({ stop_reason: 'tool_use' });
  });

  it('encodes an empty tool input as a JSON object rather than an absent delta', () => {
    const events = frames({ id: 'msg_empty', content: [{ type: 'tool_use', id: 'empty', name: 'Fixture' }] });
    expect(events[2].delta).toEqual({ type: 'input_json_delta', partial_json: '{}' });
  });

  it('keeps parallel tool block identities and indices separate', () => {
    const events = frames({ id: 'msg_parallel', content: [
      { type: 'tool_use', id: 'one', name: 'Read', input: { file_path: '/fixture/one' } },
      { type: 'tool_use', id: 'two', name: 'Read', input: { file_path: '/fixture/two' } },
    ] });
    expect(events.filter(event => event.type === 'content_block_start').map(event => [event.index, event.content_block?.id])).toEqual([[0, 'one'], [1, 'two']]);
    expect(events[events.length - 2]?.delta?.stop_reason).toBe('tool_use');
  });

  it('supports a deterministic compaction summary and legacy token-count override', () => {
    const text = 'Fixture summary.\n\nContinue only the fixture.';
    const events = frames({ id: 'msg_compact', inputTokens: 1, content: [{ type: 'text', text }] });
    expect(events[0].message?.usage.input_tokens).toBe(1);
    expect(events[2].delta).toEqual({ type: 'text_delta', text });
    expect(events[events.length - 2]?.delta?.stop_reason).toBe('end_turn');
  });
});
