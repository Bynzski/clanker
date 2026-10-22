// Deterministic Anthropic SSE for isolated native CLI smokes; never calls a provider.
function anthropicStream({ id, model = 'claude-haiku-4-5', content = [{ type: 'text', text: 'ok' }], inputTokens = 1000 }) {
  const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  let result = event('message_start', { message: { id, type: 'message', role: 'assistant', content: [], model,
    stop_reason: null, stop_sequence: null, usage: { input_tokens: inputTokens, output_tokens: 0 } } });
  for (const [index, block] of content.entries()) {
    const tool = block.type === 'tool_use';
    result += event('content_block_start', { index, content_block: tool
      ? { type: 'tool_use', id: block.id, name: block.name, input: {} } : { type: 'text', text: '' } });
    result += event('content_block_delta', { index, delta: tool
      ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input ?? {}) } : { type: 'text_delta', text: block.text } });
    result += event('content_block_stop', { index });
  }
  return result + event('message_delta', { delta: { stop_reason: content.some(block => block.type === 'tool_use') ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } })
    + event('message_stop', {});
}
module.exports = { anthropicStream };
