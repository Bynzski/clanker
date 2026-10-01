import { localAttention } from '../localAttention';

export const SOURCE = `import { emit } from '../observer.mjs';
let activeSession = process.env.CLANKER_ATTENTION_SESSION_ID || null;
export const ClankerAttention = async () => ({
  event: async ({ event }) => {
    const type = event.type;
    const props = event.properties || {};
    const sessionId = props.sessionID || props.info?.id || props.session?.id;
    if (typeof sessionId !== 'string') return;
    if (!activeSession) activeSession = sessionId;
    if (sessionId !== activeSession) return;
    if (type === 'session.status' && props.status?.type === 'busy') await emit('turn_started', sessionId);
    else if (type === 'session.idle') await emit('turn_completed', sessionId);
    else if (type === 'permission.asked' || type === 'question.asked') await emit('input_requested', sessionId);
    else if (type === 'permission.replied' || type === 'question.replied' || type === 'question.rejected') await emit('input_resolved', sessionId);
    else if (type === 'session.deleted') await emit('session_ended', sessionId);
  },
});
`;


export const local = localAttention(({ args, env, files: adapterFiles, sessionId }) => {
    if (env.OPENCODE_CONFIG_DIR || args.includes('--pure')) return null;
    return { args, env: {
      OPENCODE_CONFIG_DIR: adapterFiles.opencodeDirectory,
      ...(sessionId ? { CLANKER_ATTENTION_SESSION_ID: sessionId } : {}),
    } };

});
