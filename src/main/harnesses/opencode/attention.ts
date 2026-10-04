import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AttentionAdapterFiles } from '../types';
import { localAttention } from '../localAttention';

/** The plugin proves each session's parentage from native metadata (or the trusted
 * resumed ID) before reporting it. Child sessions are reported as child scope, and a
 * session whose parentage cannot be established is never reported. Handlers are
 * serialized so metadata lookups cannot reorder lifecycle events. */
export const SOURCE = `import { emit } from '../observer.mjs';
const trusted = process.env.CLANKER_ATTENTION_SESSION_ID || null;
const parentage = new Map();
const MAX_SESSIONS = 256;
export const ClankerAttention = async ({ client }) => {
  const remember = (info) => {
    if (!info || typeof info.id !== 'string') return;
    if (parentage.size >= MAX_SESSIONS) parentage.delete(parentage.keys().next().value);
    parentage.set(info.id, !info.parentID);
  };
  const isRoot = async (id) => {
    if (trusted && id === trusted) return true;
    if (!parentage.has(id)) {
      try {
        const result = await client.session.get({ path: { id } });
        remember(result?.data ?? result);
      } catch { /* unknown parentage fails closed */ }
    }
    return parentage.get(id);
  };
  // OpenCode exposes no turn ID. Each verified root session owns one epoch per foreground turn:
  // busy opens it, and only the matching idle completes it (which also absorbs the legacy
  // session.idle duplicate). Input events must belong to the open epoch.
  const turns = new Map();
  const classify = (type, props) => {
    const status = props.status?.type;
    if (type === 'session.status' && status === 'busy') return ['turn_started', props.sessionID];
    if ((type === 'session.status' && status === 'idle') || type === 'session.idle') return ['turn_completed', props.sessionID];
    if (type === 'permission.asked') return ['input_requested', props.sessionID, props.id, 'approval'];
    if (type === 'question.asked') return ['input_requested', props.sessionID, props.id, 'input'];
    if (type === 'permission.replied' || type === 'question.replied' || type === 'question.rejected') return ['input_resolved', props.sessionID, props.requestID];
    if (type === 'session.deleted') return ['session_ended', props.info?.id];
    return null;
  };
  const handle = async (event) => {
    const props = event.properties || {};
    if (event.type === 'session.created' || event.type === 'session.updated') return remember(props.info);
    const [kind, sessionId, inputId, requestKind] = classify(event.type, props) ?? [];
    if (!kind || typeof sessionId !== 'string') return;
    const root = await isRoot(sessionId);
    if (root === undefined) return;
    const fields = { scope: root ? 'root' : 'child', sessionId, nativeEvent: event.type };
    if (!root) return emit(kind, fields);
    const turn = turns.get(sessionId) ?? { epoch: 0, open: false };
    turns.set(sessionId, turn);
    if (kind === 'session_ended') { turns.delete(sessionId); return emit(kind, fields); }
    if (kind === 'turn_started') {
      if (!turn.open) { turn.epoch += 1; turn.open = true; }
    } else if (!turn.open) return;
    if (kind === 'turn_completed') turn.open = false;
    await emit(kind, { ...fields, turnId: String(turn.epoch), inputId: typeof inputId === 'string' ? inputId : undefined, requestKind });
  };
  let queue = Promise.resolve();
  return { event: ({ event }) => (queue = queue.then(() => handle(event)).catch(() => undefined)) };
};
`;


export const local = localAttention(({ args, env, files: adapterFiles, rootSessionId }) => {
    if (env.OPENCODE_CONFIG_DIR || args.includes('--pure')) return null;
    return { args, env: {
      OPENCODE_CONFIG_DIR: path.join(adapterFiles.resourceRoot ?? path.dirname(adapterFiles.command), 'opencode'),
      ...(rootSessionId ? { CLANKER_ATTENTION_SESSION_ID: rootSessionId } : {}),
    } };

});

export function prepareResources(files: AttentionAdapterFiles, observer: string): void {
  const directory = path.join(files.resourceRoot ?? path.dirname(files.command), 'opencode');
  fs.mkdirSync(path.join(directory, 'plugins'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'observer.mjs'), observer, { mode: 0o600 });
  fs.writeFileSync(path.join(directory, 'plugins', 'clanker-attention.js'), SOURCE, { mode: 0o600 });
}
