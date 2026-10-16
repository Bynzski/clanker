import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AttentionAdapterFiles } from '../types';
import { localAttention } from '../localAttention';
import { openCodeMajorVersion } from './version';
import { openCodePrivateServerArgs } from './privateServer';

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
// Turn IDs are unique to this module instance: a restarted plugin host would otherwise restart them at 1
// and collide with retired turns, so a bare counter would restart at 1 and collide with retired turns.
const instance = Math.random().toString(36).slice(2, 10);
const turnOf = (n) => instance + '.' + n;
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
      // Bounded: every later event waits behind this lookup, so a hung request must not stall them all.
      let timer;
      try {
        const result = await Promise.race([
          client.session.get({ path: { id } }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 2000); }),
        ]);
        remember(result?.data ?? result);
      } catch { /* unknown parentage fails closed */ } finally { clearTimeout(timer); }
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
    await emit(kind, { ...fields, turnId: turnOf(turn.epoch), inputId: typeof inputId === 'string' ? inputId : undefined, requestKind, cwd });
  };
  let queue = Promise.resolve();
  return { event: ({ event }) => (queue = queue.then(() => handle(event)).catch(() => undefined)) };
};
`;


/**
 * OpenCode 2.x plugin (measured against 2.0.26). A plugin is a module whose default export is
 * `{ id, setup(ctx) }`; lifecycle comes from `ctx.event.subscribe()` as `{ type, data }`:
 * `session.execution.started|succeeded|failed|interrupted` (interrupt `reason`: user, shutdown,
 * superseded, inactivity), `permission.asked` (`id`) / `permission.replied` (`requestID`),
 * `form.created` (`form.id`, `form.sessionID`) / `form.replied` / `form.cancelled` (`id`),
 * `session.created` (`parentID`, `location.directory`), `session.moved` and `session.deleted`.
 * Parentage is proven exactly as for 1.x: from `session.created`, the trusted resumed ID, or a bounded
 * `ctx.session.get`; a session of unknown parentage is never reported. Execution events already scope
 * one foreground run, so each root session owns one epoch per execution. A superseded execution is
 * continued by the next one and settles nothing; a shutdown is the process ending, which the launch
 * wrapper reports.
 */
export const SOURCE_V2 = `import { emit } from '../observer.mjs';
const trusted = process.env.CLANKER_ATTENTION_SESSION_ID || null;
const instance = Math.random().toString(36).slice(2, 10);
const turnOf = (n) => instance + '.' + n;
const MAX_SESSIONS = 256;
const bounded = (map, key, value) => {
  if (!map.has(key) && map.size >= MAX_SESSIONS) map.delete(map.keys().next().value);
  map.set(key, value);
};
export default {
  id: 'clanker-attention',
  setup(ctx) {
    const parentage = new Map();
    const directories = new Map();
    const turns = new Map();
    const remember = (id, parentID, directory) => {
      if (typeof id !== 'string' || !id) return;
      bounded(parentage, id, !parentID);
      if (typeof directory === 'string' && directory) bounded(directories, id, directory);
    };
    const fallbackDirectory = typeof ctx.location?.directory === 'string' && ctx.location.directory ? ctx.location.directory : undefined;
    const located = (id) => directories.get(id) ?? fallbackDirectory;
    const isRoot = async (id) => {
      if (trusted && id === trusted) return true;
      if (!parentage.has(id)) {
        // Bounded: every later event waits behind this lookup, so a hung request must not stall them all.
        let timer;
        try {
          const result = await Promise.race([
            ctx.session.get({ sessionID: id }),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 2000); }),
          ]);
          const info = result?.data ?? result;
          if (info && (info.id === undefined || info.id === id)) remember(id, info.parentID, info.location?.directory);
        } catch { /* unknown parentage fails closed */ } finally { clearTimeout(timer); }
      }
      return parentage.get(id);
    };
    const classify = (type, data) => {
      if (type === 'session.execution.started') return ['turn_started', data.sessionID];
      if (type === 'session.execution.succeeded') return ['turn_completed', data.sessionID];
      if (type === 'session.execution.failed') return ['turn_failed', data.sessionID];
      if (type === 'session.execution.interrupted' && (data.reason === 'user' || data.reason === 'inactivity')) return ['turn_interrupted', data.sessionID];
      if (type === 'permission.asked') return ['input_requested', data.sessionID, data.id, 'approval'];
      if (type === 'form.created') return ['input_requested', data.form?.sessionID, data.form?.id, 'input'];
      if (type === 'permission.replied') return ['input_resolved', data.sessionID, data.requestID];
      if (type === 'form.replied' || type === 'form.cancelled') return ['input_resolved', data.sessionID, data.id];
      if (type === 'session.deleted') return ['session_ended', data.sessionID];
      return null;
    };
    const handle = async (event) => {
      const type = event?.type;
      const data = event?.data || {};
      if (type === 'session.created') { remember(data.sessionID, data.parentID, data.location?.directory); return; }
      if (type === 'session.moved') {
        const id = data.sessionID;
        const directory = data.location?.directory ?? data.directory;
        if (typeof id !== 'string' || typeof directory !== 'string' || !directory || directories.get(id) === directory) return;
        bounded(directories, id, directory);
        if (await isRoot(id) === true) await emit('location_changed', { scope: 'root', sessionId: id, nativeEvent: type, cwd: directory });
        return;
      }
      let [kind, sessionId, inputId, requestKind] = classify(type, data) ?? [];
      if (!kind || typeof sessionId !== 'string') return;
      const root = await isRoot(sessionId);
      if (root === undefined) return;
      const fields = { scope: root ? 'root' : 'child', sessionId, nativeEvent: type };
      if (!root) return emit(kind, fields);
      if (kind === 'session_ended') { turns.delete(sessionId); directories.delete(sessionId); return emit(kind, fields); }
      const turn = turns.get(sessionId) ?? { epoch: 0, open: false };
      bounded(turns, sessionId, turn);
      if (kind === 'turn_started') {
        if (!turn.open) { turn.epoch += 1; turn.open = true; }
      } else if (!turn.open) return;
      if (kind === 'turn_completed' || kind === 'turn_failed' || kind === 'turn_interrupted') turn.open = false;
      const cwd = kind === 'turn_started' || kind === 'turn_completed' ? located(sessionId) : undefined;
      await emit(kind, { ...fields, turnId: turnOf(turn.epoch), inputId: typeof inputId === 'string' ? inputId : undefined, requestKind, cwd });
    };
    const controller = new AbortController();
    let queue = Promise.resolve();
    (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        queue = queue.then(() => handle(event)).catch(() => undefined);
      }
    })().catch(() => undefined);
    return () => controller.abort();
  },
};
`;

const V2_CONFIG = 'opencode-v2.json';
const V2_PLUGIN_DIRECTORY = 'v2-plugin';

function resourceDirectory(files: AttentionAdapterFiles): string {
  return path.join(files.resourceRoot ?? path.dirname(files.command), 'opencode');
}

export const local = localAttention(({ args, env, files: adapterFiles, rootSessionId, platform }) => {
    const directory = resourceDirectory(adapterFiles);
    const session: Record<string, string> = rootSessionId ? { CLANKER_ATTENTION_SESSION_ID: rootSessionId } : {};
    if ((openCodeMajorVersion(env, platform) ?? 1) >= 2) {
      // The shared background service runs plugins with another process's environment, so this launch
      // gets its own private server. A user-chosen server, or a config file of their own, is left alone.
      const privateArgs = openCodePrivateServerArgs(args);
      if (env.OPENCODE_CONFIG || !privateArgs) return null;
      return {
        args: privateArgs,
        // Additive: OpenCode merges this file over the user's global and project config.
        env: { OPENCODE_CONFIG: path.join(directory, V2_CONFIG), ...session },
      };
    }
    if (env.OPENCODE_CONFIG_DIR || args.includes('--pure')) return null;
    return { args, env: { OPENCODE_CONFIG_DIR: directory, ...session } };
});

export function prepareResources(files: AttentionAdapterFiles, observer: string): void {
  const directory = resourceDirectory(files);
  const v2Plugin = path.join(directory, V2_PLUGIN_DIRECTORY);
  fs.mkdirSync(path.join(directory, 'plugins'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(v2Plugin, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'observer.mjs'), observer, { mode: 0o600 });
  fs.writeFileSync(path.join(directory, 'plugins', 'clanker-attention.js'), SOURCE, { mode: 0o600 });
  // OpenCode 2.x loads plugin directories named in config (a single file entry is rejected upstream).
  fs.writeFileSync(path.join(v2Plugin, 'package.json'), `${JSON.stringify({ name: 'clanker-attention', private: true, type: 'module', main: 'index.js' })}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(v2Plugin, 'index.js'), SOURCE_V2, { mode: 0o600 });
  fs.writeFileSync(path.join(directory, V2_CONFIG), `${JSON.stringify({ plugins: [v2Plugin] })}\n`, { mode: 0o600 });
}
