import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AttentionAdapterFiles } from '../types';
import { localAttention } from '../localAttention';

/** The plugin proves each session's parentage from native metadata (or the trusted
 * resumed ID) before reporting it. Child sessions are reported as child scope, and a
 * session whose parentage cannot be established is never reported. Handlers are
 * serialized so metadata lookups cannot reorder lifecycle events.
 * Location: a session's native info carries its `directory`; a verified root reports it on its turn
 * events (the plugin's own instance directory when the info has none), and immediately when native
 * session.updated changes the directory. Children never move the root location. */
export const SOURCE = `import { emit } from '../observer.mjs';
const trusted = process.env.CLANKER_ATTENTION_SESSION_ID || null;
const parentage = new Map();
const MAX_SESSIONS = 256;
const directories = new Map();
export const ClankerAttention = async ({ client, directory }) => {
  const remember = (info) => {
    if (!info || typeof info.id !== 'string') return;
    if (parentage.size >= MAX_SESSIONS) parentage.delete(parentage.keys().next().value);
    parentage.set(info.id, !info.parentID);
    if (typeof info.directory === 'string' && info.directory) {
      if (directories.size >= MAX_SESSIONS) directories.delete(directories.keys().next().value);
      directories.set(info.id, info.directory);
    }
  };
  const located = (id) => directories.get(id) ?? (typeof directory === 'string' && directory ? directory : undefined);
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
    if (event.type === 'session.created' || event.type === 'session.updated') {
      const info = props.info;
      const previous = directories.get(info?.id);
      remember(info);
      if (event.type === 'session.updated' && typeof info?.id === 'string' && typeof info.directory === 'string'
        && info.directory && info.directory !== previous && await isRoot(info.id) === true) {
        await emit('location_changed', { scope: 'root', sessionId: info.id, nativeEvent: event.type, cwd: info.directory });
      }
      return;
    }
    // Errors can precede automatic compaction/recovery; retain only a candidate outcome
    // for this open epoch. Native idle settles it; a resumed busy/successful message clears it.
    if (event.type === 'session.error' || event.type === 'message.updated') {
      const info = event.type === 'message.updated' ? props.info : undefined;
      if (info && info.role !== 'assistant') return;
      const id = info?.sessionID ?? props.sessionID;
      if (typeof id !== 'string' || await isRoot(id) !== true) return;
      const turn = turns.get(id);
      if (!turn?.open) return;
      const error = info?.error ?? props.error;
      if (error) turn.outcome = error.name === 'MessageAbortedError' ? 'turn_interrupted' : 'turn_failed';
      else if (info?.time?.completed) turn.outcome = undefined;
      return;
    }
    let [kind, sessionId, inputId, requestKind] = classify(event.type, props) ?? [];
    if (!kind || typeof sessionId !== 'string') return;
    const root = await isRoot(sessionId);
    if (root === undefined) return;
    const fields = { scope: root ? 'root' : 'child', sessionId, nativeEvent: event.type };
    if (!root) return emit(kind, fields);
    const turn = turns.get(sessionId) ?? { epoch: 0, open: false };
    turns.set(sessionId, turn);
    if (kind === 'session_ended') { turns.delete(sessionId); directories.delete(sessionId); return emit(kind, fields); }
    if (kind === 'turn_started') {
      if (!turn.open) { turn.epoch += 1; turn.open = true; }
      turn.outcome = undefined;
    } else if (!turn.open) return;
    if (kind === 'turn_completed') { turn.open = false; kind = turn.outcome ?? kind; }
    const cwd = kind === 'turn_started' || kind === 'turn_completed' ? located(sessionId) : undefined;
    await emit(kind, { ...fields, turnId: String(turn.epoch), inputId: typeof inputId === 'string' ? inputId : undefined, requestKind, cwd });
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
