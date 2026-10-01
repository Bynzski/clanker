import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AttentionAdapterFiles } from '../types';
import { localAttention } from '../localAttention';

export const SOURCE = `import { emit } from './observer.mjs';
export default function (pi) {
  pi.on('agent_start', (_event, ctx) => emit('turn_started', ctx.sessionManager?.getSessionId?.()));
  pi.on('agent_settled', (_event, ctx) => emit('turn_completed', ctx.sessionManager?.getSessionId?.()));
  pi.on('session_shutdown', (_event, ctx) => emit('session_ended', ctx.sessionManager?.getSessionId?.()));
}
`;


export const local = localAttention(({ args, files: adapterFiles }) => {
  return { args: [...args, '--extension', path.join(path.dirname(adapterFiles.command), 'pi.ts')], env: {} };
});

export function prepareResources(files: AttentionAdapterFiles): void {
  fs.writeFileSync(path.join(path.dirname(files.command), 'pi.ts'), SOURCE, { mode: 0o600 });
}
