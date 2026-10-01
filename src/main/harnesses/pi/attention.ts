import { localAttention } from '../localAttention';

export const SOURCE = `import { emit } from './observer.mjs';
export default function (pi) {
  pi.on('agent_start', (_event, ctx) => emit('turn_started', ctx.sessionManager?.getSessionId?.()));
  pi.on('agent_settled', (_event, ctx) => emit('turn_completed', ctx.sessionManager?.getSessionId?.()));
  pi.on('session_shutdown', (_event, ctx) => emit('session_ended', ctx.sessionManager?.getSessionId?.()));
}
`;


export const local = localAttention(({ args, files: adapterFiles }) => {
  return { args: [...args, '--extension', adapterFiles.piExtension], env: {} };
});
