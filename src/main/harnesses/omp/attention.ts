import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AttentionAdapterFiles } from '../types';
import { localAttention } from '../localAttention';

/** Completion is the main session's `session_stop`, which OMP defers until agent-owned
 * background jobs are idle and never emits for task/subagent sessions. `agent_end` is
 * not a terminal completion. Hooks are rebound to subagent sessions, so the subject
 * comes from `ctx.agent.kind`; an unknown kind is never reported as root. */
export const SOURCE = `import { emit } from './observer.mjs';
// OMP exposes no turn ID. The extension owns one epoch per main-session foreground turn:
// agent_start opens it and only the main session_stop closes it.
let epoch = 0;
let open = false;
const sessionId = (ctx) => ctx.sessionManager?.getSessionId?.();
const kind = (ctx) => ctx.agent?.kind === 'main' ? 'root' : ctx.agent?.kind === 'sub' ? 'child' : undefined;
export default function (omp) {
  omp.on('agent_start', (_event, ctx) => {
    const scope = kind(ctx);
    if (scope !== 'root') return emit('turn_started', { scope, sessionId: sessionId(ctx), nativeEvent: 'agent_start' });
    if (!open) { epoch += 1; open = true; }
    return emit('turn_started', { scope, sessionId: sessionId(ctx), turnId: String(epoch), nativeEvent: 'agent_start' });
  });
  omp.on('session_stop', (_event, ctx) => {
    if (ctx.agent?.kind === 'sub') return emit('turn_completed', { scope: 'child', sessionId: sessionId(ctx), nativeEvent: 'session_stop' });
    if (!open) return;
    open = false;
    return emit('turn_completed', { scope: 'root', sessionId: sessionId(ctx), turnId: String(epoch), nativeEvent: 'session_stop' });
  });
  omp.on('session_shutdown', (_event, ctx) => {
    const scope = kind(ctx);
    if (scope === 'root') open = false;
    return emit('session_ended', { scope, sessionId: sessionId(ctx), nativeEvent: 'session_shutdown' });
  });
}
`;


export const local = localAttention(({ args, files: adapterFiles }) => {
  return { args: [...args, '--extension', path.join(adapterFiles.resourceRoot ?? path.dirname(adapterFiles.command), 'omp.ts')], env: {} };
});

export function prepareResources(files: AttentionAdapterFiles, observer: string): void {
  fs.writeFileSync(path.join(files.resourceRoot ?? path.dirname(files.command), 'observer.mjs'), observer, { mode: 0o600 });
  fs.writeFileSync(path.join(files.resourceRoot ?? path.dirname(files.command), 'omp.ts'), SOURCE, { mode: 0o600 });
}
