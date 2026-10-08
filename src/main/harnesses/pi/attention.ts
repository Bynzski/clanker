import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AttentionAdapterFiles } from '../types';
import { localAttention } from '../localAttention';

/** `agent_settled` (no retry, compaction, or queued continuation left) is the foreground
 * completion; never regress to the lower-level `agent_end`.
 * Location: `ctx.cwd` is the session's directory. A command never moves it; replacing the session
 * (resume, new, fork) does: Pi ends the old session (`session_shutdown`), then starts the new one with
 * its own cwd (`session_start`, reported as `location_changed`). */
export const SOURCE = `import { emit } from './observer.mjs';
// Pi exposes no turn ID. The extension owns one epoch per foreground turn: agent_start opens it
// and only the matching agent_settled can complete it, so a late settle can never close a newer turn.
let epoch = 0;
let open = false;
let root;
let result = 'turn_completed';
let promptEpoch = 0;
let pending;
const current = (ctx) => open && sessionId(ctx) === root;
const sessionId = (ctx) => ctx.sessionManager?.getSessionId?.();
const cwd = (ctx) => typeof ctx.cwd === 'string' ? ctx.cwd : undefined;
export default function (pi) {
  pi.on('agent_start', (_event, ctx) => {
    if (!open) { epoch += 1; open = true; root = sessionId(ctx); result = 'turn_completed'; pending = undefined; }
    if (!current(ctx)) return;
    return emit('turn_started', { scope: 'root', sessionId: sessionId(ctx), turnId: String(epoch), nativeEvent: 'agent_start', cwd: cwd(ctx) });
  });
  // Prompt events bracket the outermost blocking ctx.ui call. Pi provides no request ID;
  // correlate locally, never forward dialog titles or infer permission from their text.
  pi.on('ui_prompt_start', (event, ctx) => {
    if (!current(ctx) || pending) return;
    pending = { id: String(++promptEpoch), kind: event.kind };
    const requestKind = ['select', 'input', 'editor'].includes(event.kind) ? 'input' : undefined;
    return emit('input_requested', { scope: 'root', sessionId: root, turnId: String(epoch), inputId: pending.id, requestKind, nativeEvent: 'ui_prompt_start' });
  });
  pi.on('ui_prompt_end', (event, ctx) => {
    if (!current(ctx) || !pending || pending.kind !== event.kind) return;
    const inputId = pending.id;
    pending = undefined;
    return emit('input_resolved', { scope: 'root', sessionId: root, turnId: String(epoch), inputId, nativeEvent: 'ui_prompt_end' });
  });
  // A transient error is not a failed turn: a later successful retry replaces it.
  pi.on('message_end', (event, ctx) => {
    if (!current(ctx) || event.message?.role !== 'assistant') return;
    result = event.message.stopReason === 'error' ? 'turn_failed'
      : event.message.stopReason === 'aborted' ? 'turn_interrupted' : 'turn_completed';
  });
  pi.on('session_compact_failed', (event, ctx) => {
    if (!current(ctx)) return;
    if (event.aborted === true) result = 'turn_interrupted';
    else if (typeof event.errorMessage === 'string' && event.errorMessage) result = 'turn_failed';
  });
  pi.on('agent_settled', (event, ctx) => {
    if (!current(ctx)) return;
    open = false;
    pending = undefined;
    // Older Pi omits aborted; preserve its ordinary successful settlement behavior.
    const outcome = event.aborted === true ? 'turn_interrupted' : result;
    return emit(outcome, { scope: 'root', sessionId: sessionId(ctx), turnId: String(epoch), nativeEvent: 'agent_settled', cwd: cwd(ctx) });
  });
  pi.on('session_shutdown', (_event, ctx) => {
    open = false;
    pending = undefined;
    result = 'turn_completed';
    root = undefined;
    return emit('session_ended', { scope: 'root', sessionId: sessionId(ctx), nativeEvent: 'session_shutdown' });
  });
  pi.on('session_start', (_event, ctx) => {
    if (!cwd(ctx)) return;
    return emit('location_changed', { scope: 'root', sessionId: sessionId(ctx), nativeEvent: 'session_start', cwd: cwd(ctx) });
  });
}
`;


export const local = localAttention(({ args, files: adapterFiles }) => {
  return { args: [...args, '--extension', path.join(adapterFiles.resourceRoot ?? path.dirname(adapterFiles.command), 'pi.ts')], env: {} };
});

export function prepareResources(files: AttentionAdapterFiles, observer: string): void {
  fs.writeFileSync(path.join(files.resourceRoot ?? path.dirname(files.command), 'observer.mjs'), observer, { mode: 0o600 });
  fs.writeFileSync(path.join(files.resourceRoot ?? path.dirname(files.command), 'pi.ts'), SOURCE, { mode: 0o600 });
}
