import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AttentionAdapterFiles } from '../types';
import { localAttention } from '../localAttention';

/** `agent_settled` (no retry, compaction, or queued continuation left) is the foreground
 * completion; never regress to the lower-level `agent_end`. */
export const SOURCE = `import { emit } from './observer.mjs';
// Pi exposes no turn ID. The extension owns one epoch per foreground turn: agent_start opens it
// and only the matching agent_settled can complete it, so a late settle can never close a newer turn.
let epoch = 0;
let open = false;
const sessionId = (ctx) => ctx.sessionManager?.getSessionId?.();
export default function (pi) {
  pi.on('agent_start', (_event, ctx) => {
    if (!open) { epoch += 1; open = true; }
    return emit('turn_started', { scope: 'root', sessionId: sessionId(ctx), turnId: String(epoch), nativeEvent: 'agent_start' });
  });
  pi.on('agent_settled', (_event, ctx) => {
    if (!open) return;
    open = false;
    return emit('turn_completed', { scope: 'root', sessionId: sessionId(ctx), turnId: String(epoch), nativeEvent: 'agent_settled' });
  });
  pi.on('session_shutdown', (_event, ctx) => {
    open = false;
    return emit('session_ended', { scope: 'root', sessionId: sessionId(ctx), nativeEvent: 'session_shutdown' });
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
