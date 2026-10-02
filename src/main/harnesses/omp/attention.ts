import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AttentionAdapterFiles } from '../types';
import { localAttention } from '../localAttention';

/** Completion is the main session's `session_stop`, which OMP defers until agent-owned
 * background jobs are idle and never emits for task/subagent sessions. `agent_end` is
 * not a terminal completion. Hooks are rebound to subagent sessions, so the subject
 * comes from `ctx.agent.kind`; an unknown kind is never reported as root. */
export const SOURCE = `import { emit } from './observer.mjs';
const kind = (ctx) => ctx.agent?.kind === 'main' ? 'root' : ctx.agent?.kind === 'sub' ? 'child' : undefined;
const report = (type, nativeEvent, scope) => (_event, ctx) => emit(type, { scope: scope(ctx), sessionId: ctx.sessionManager?.getSessionId?.(), nativeEvent });
export default function (omp) {
  omp.on('agent_start', report('turn_started', 'agent_start', kind));
  omp.on('session_stop', report('turn_completed', 'session_stop', (ctx) => ctx.agent?.kind === 'sub' ? 'child' : 'root'));
  omp.on('session_shutdown', report('session_ended', 'session_shutdown', kind));
}
`;


export const local = localAttention(({ args, files: adapterFiles }) => {
  return { args: [...args, '--extension', path.join(adapterFiles.resourceRoot ?? path.dirname(adapterFiles.command), 'omp.ts')], env: {} };
});

export function prepareResources(files: AttentionAdapterFiles, observer: string): void {
  fs.writeFileSync(path.join(files.resourceRoot ?? path.dirname(files.command), 'observer.mjs'), observer, { mode: 0o600 });
  fs.writeFileSync(path.join(files.resourceRoot ?? path.dirname(files.command), 'omp.ts'), SOURCE, { mode: 0o600 });
}
