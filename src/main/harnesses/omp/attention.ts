import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AttentionAdapterFiles } from '../types';
import { localAttention } from '../localAttention';

/** OMP 18.4.10 awaits all session_stop control hooks before notifying agent_end extensions.
 * agent_end.willContinue includes stop-hook continuation and pending agent-owned background work.
 * Only the terminal notification settles our foreground epoch; session_stop itself proves nothing.
 * Unknown agent kinds and unrelated sessions never close the main epoch. */
export const SOURCE = `import { emit } from './observer.mjs';
// OMP exposes no turn ID. The extension owns one epoch per main-session foreground turn:
// agent_start opens it and only the terminal main agent_end closes it.
let epoch = 0;
let open = false;
let root;
const sessionId = (ctx) => ctx.sessionManager?.getSessionId?.();
const kind = (ctx) => ctx.agent?.kind === 'main' ? 'root' : ctx.agent?.kind === 'sub' ? 'child' : undefined;
const cwd = (ctx) => kind(ctx) === 'root' && typeof ctx.cwd === 'string' ? ctx.cwd : undefined;
const located = (ctx, nativeEvent) => cwd(ctx) ? emit('location_changed', { scope: 'root', sessionId: sessionId(ctx), nativeEvent, cwd: cwd(ctx) }) : undefined;
export default function (omp) {
  omp.on('agent_start', (_event, ctx) => {
    const scope = kind(ctx);
    if (scope !== 'root') return emit('turn_started', { scope, sessionId: sessionId(ctx), nativeEvent: 'agent_start' });
    if (root && sessionId(ctx) !== root) return; // require explicit native switch/shutdown
    if (!open) { epoch += 1; open = true; root = sessionId(ctx); }
    if (sessionId(ctx) !== root) return;
    return emit('turn_started', { scope, sessionId: sessionId(ctx), turnId: String(epoch), nativeEvent: 'agent_start', cwd: cwd(ctx) });
  });
  omp.on('agent_end', (event, ctx) => {
    const scope = kind(ctx);
    if (scope !== 'root' || !open || sessionId(ctx) !== root || event.willContinue === true) return;
    open = false;
    const last = [...(event.messages ?? [])].reverse().find(message => message.role === 'assistant');
    if (!last) return emit('observer_diagnostic', { diagnostic: 'settlement-unverified', nativeEvent: 'agent_end' });
    const outcome = last.stopReason === 'aborted' ? 'turn_interrupted'
      : last.stopReason === 'error' ? 'turn_failed' : 'turn_completed';
    return emit(outcome, { scope, sessionId: root, turnId: String(epoch), nativeEvent: 'agent_end', cwd: cwd(ctx) });
  });
  omp.on('session_start', (_event, ctx) => located(ctx, 'session_start'));
  omp.on('session_switch', async (_event, ctx) => {
    if (kind(ctx) !== 'root') return;
    const next = sessionId(ctx);
    if (root && next && next !== root) {
      await emit('session_ended', { scope: 'root', sessionId: root, nativeEvent: 'session_switch' });
      open = false;
      root = undefined;
    }
    return located(ctx, 'session_switch');
  });
  omp.on('session_shutdown', (_event, ctx) => {
    const scope = kind(ctx);
    if (scope === 'root' && (!root || sessionId(ctx) === root)) { open = false; root = undefined; }
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
