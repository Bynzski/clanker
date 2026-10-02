import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AttentionAdapterFiles } from '../types';
import { localAttention } from '../localAttention';

/** `agent_settled` (no retry, compaction, or queued continuation left) is the foreground
 * completion; never regress to the lower-level `agent_end`. */
export const SOURCE = `import { emit } from './observer.mjs';
const report = (type, nativeEvent) => (_event, ctx) => emit(type, { scope: 'root', sessionId: ctx.sessionManager?.getSessionId?.(), nativeEvent });
export default function (pi) {
  pi.on('agent_start', report('turn_started', 'agent_start'));
  pi.on('agent_settled', report('turn_completed', 'agent_settled'));
  pi.on('session_shutdown', report('session_ended', 'session_shutdown'));
}
`;


export const local = localAttention(({ args, files: adapterFiles }) => {
  return { args: [...args, '--extension', path.join(adapterFiles.resourceRoot ?? path.dirname(adapterFiles.command), 'pi.ts')], env: {} };
});

export function prepareResources(files: AttentionAdapterFiles, observer: string): void {
  fs.writeFileSync(path.join(files.resourceRoot ?? path.dirname(files.command), 'observer.mjs'), observer, { mode: 0o600 });
  fs.writeFileSync(path.join(files.resourceRoot ?? path.dirname(files.command), 'pi.ts'), SOURCE, { mode: 0o600 });
}
