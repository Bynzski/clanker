import { HarnessCapabilityError } from './types';

function invalid(): never {
  throw new HarnessCapabilityError('parse-failure', 'The harness did not return a completed commit message');
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : invalid();
}

/** Never fall back to decorated stdout, stderr, deltas, or reasoning blocks. */
function events(output: string): Record<string, unknown>[] {
  try {
    const rows = output.split(/\r?\n/).filter((line) => line.trim()).map((line) => record(JSON.parse(line)));
    return rows.length ? rows : invalid();
  } catch { return invalid(); }
}

export function parseCodexCommitOutput(output: string): string {
  let text: string | undefined;
  let completed = false;
  for (const event of events(output)) {
    if (event.type === 'error' || event.type === 'turn.failed') invalid();
    if (event.type === 'turn.started') { text = undefined; completed = false; }
    if (event.type === 'item.completed') {
      const item = record(event.item);
      if (item.type === 'agent_message' && item.channel !== 'analysis') {
        text = typeof item.text === 'string' ? item.text : invalid();
      }
    }
    if (event.type === 'turn.completed') completed = true;
  }
  return completed && text?.trim() ? text : invalid();
}

export function parseOpenCodeCommitOutput(output: string): string {
  let text = '';
  let completed = false;
  for (const event of events(output)) {
    if (event.type === 'error') invalid();
    if (event.type === 'step_start') { text = ''; completed = false; }
    if (event.type === 'text') {
      const part = record(event.part);
      if (part.synthetic !== true) text += typeof part.text === 'string' ? part.text : invalid();
    }
    if (event.type === 'step_finish') completed = record(event.part).reason === 'stop';
  }
  return completed && text.trim() ? text : invalid();
}

/** Pi and OMP share message_end and assistant content-block semantics. */
export function parsePiCommitOutput(output: string): string {
  let text: string | undefined;
  for (const event of events(output)) {
    if (event.type === 'agent_settled' && event.aborted === true) invalid();
    if (event.type === 'message_start' && record(event.message).role === 'assistant') text = undefined;
    if (event.type !== 'message_end') continue;
    const message = record(event.message);
    if (message.role !== 'assistant') continue;
    // A later failed/truncated/tool-call response must not expose an earlier answer.
    text = undefined;
    if (message.stopReason !== 'stop' || !Array.isArray(message.content)) continue;
    text = message.content.map((block: unknown) => {
      const part = record(block);
      return part.type === 'text' ? (typeof part.text === 'string' ? part.text : invalid()) : '';
    }).join('');
  }
  return text?.trim() ? text : invalid();
}
