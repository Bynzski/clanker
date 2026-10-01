import { localAttention } from '../localAttention';

export const SOURCE = `import { emit } from './observer.mjs';
export default function (omp) {
  omp.on('agent_start', (_event, ctx) => emit('turn_started', ctx.sessionManager?.getSessionId?.()));
  omp.on('agent_end', (_event, ctx) => emit('turn_completed', ctx.sessionManager?.getSessionId?.()));
  omp.on('session_shutdown', (_event, ctx) => emit('session_ended', ctx.sessionManager?.getSessionId?.()));
}
`;


export const local = localAttention(({ args, files: adapterFiles }) => {
  return { args: [...args, '--extension', adapterFiles.ompExtension], env: {} };
});
