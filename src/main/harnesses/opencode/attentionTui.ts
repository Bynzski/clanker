/** OpenCode 2.0.26 native TUI selection is client-local. Server session starts cannot
 * prove which conversation this terminal selected. Keep observation and explicit
 * identity boundaries in one serialized client queue, never weaken shared roots. */
export const SOURCE = `import { createEffect } from 'solid-js';
import { emit } from '../observer.mjs';
import { createObserver } from '../v2-plugin/index.js';
export default {
  id: 'clanker-attention',
  setup(ctx) {
    const MAX_SESSIONS = 256;
    const histories = new Map();
    let selected;
    let bound = process.env.CLANKER_ATTENTION_SESSION_ID || undefined;
    let disposed = false;
    let reporting = false;
    let nativeRoute;
    let selectionEpoch = 0;
    const readRoute = () => {
      const route = ctx.ui.router.current();
      const id = route.type === 'session' ? route.sessionID : undefined;
      if (nativeRoute !== id) { nativeRoute = id; selectionEpoch++; }
      return route;
    };
    // Background events advance native epochs without publishing as this terminal's root.
    const handle = createObserver({ location: ctx.location, session: ctx.client.session },
      (kind, fields) => !disposed && reporting && fields.sessionId === bound ? emit(kind, fields) : Promise.resolve(false));
    const observe = async (event, foreground) => {
      reporting = foreground;
      try { await handle(event); } finally { reporting = false; }
    };
    let queue = Promise.resolve();
    const enqueue = (work) => { queue = queue.then(() => disposed ? undefined : work()).catch(() => undefined); };
    const idOf = (event) => event.data?.sessionID ?? event.data?.form?.sessionID;
    const relevant = (type) => ['session.execution.started', 'session.execution.succeeded',
      'session.execution.failed', 'session.execution.interrupted', 'permission.asked',
      'permission.replied', 'form.created', 'form.replied', 'form.cancelled'].includes(type);
    const terminal = (history) => {
      const event = history.findLast(item => item.type.startsWith('session.execution.'));
      return ['session.execution.succeeded', 'session.execution.failed', 'session.execution.interrupted'].includes(event?.type)
        && !['superseded', 'shutdown'].includes(event.data?.reason) ? event : undefined;
    };
    const foregroundFor = (route, id) => {
      if (route.type === 'home') return id === bound;
      if (route.type !== 'session') return false;
      if (route.sessionID === id) return true;
      // Viewing a child does not replace authority, but its already-bound parent stays live.
      if (id !== bound) return false;
      let current = route.sessionID;
      const seen = new Set();
      while (typeof current === 'string' && seen.size < 64 && !seen.has(current)) {
        seen.add(current);
        const info = ctx.data.session.get(current);
        if (!info || info.id !== current) return false;
        if (info.parentID === bound) return true;
        current = info.parentID;
      }
      return false;
    };
    const project = (event) => {
      const data = event.data ?? {};
      return { type: event.type, data: { sessionID: data.sessionID, id: data.id,
        requestID: data.requestID, reason: data.reason, parentID: data.parentID,
        directory: data.directory, location: data.location ? { directory: data.location.directory } : undefined,
        ...(data.form ? { form: { id: data.form.id, sessionID: data.form.sessionID } } : {}) } };
    };
    const remember = (event) => {
      const id = idOf(event);
      if (typeof id !== 'string' || !relevant(event.type)) return;
      if (!histories.has(id) && histories.size >= MAX_SESSIONS) histories.delete(histories.keys().next().value);
      const previous = histories.get(id) ?? [];
      let history;
      if (event.type === 'session.execution.started') history = [event];
      else if (event.type.startsWith('session.execution.')) {
        if (['superseded', 'shutdown'].includes(event.data.reason)) return;
        const start = previous.find(item => item.type === 'session.execution.started');
        history = start ? [start, event] : [event];
      } else {
        if (terminal(previous)) return;
        if (event.type === 'permission.asked' || event.type === 'form.created') history = [...previous, event];
        else {
          const requestID = event.data.requestID ?? event.data.id;
          if (typeof requestID !== 'string') return;
          history = previous.filter(item => (item.data.id ?? item.data.form?.id) !== requestID);
        }
      }
      // Native start/terminal and unresolved requests only, not resolved-tool history.
      if (history.length > 32) { histories.delete(id); return; }
      histories.set(id, history);
    };
    createEffect(() => {
      if (disposed) return;
      const route = readRoute();
      const info = route.type === 'session' ? ctx.data.session.get(route.sessionID) : undefined;
      // Never promote a child, missing metadata or a merely created server session.
      if (route.type !== 'session' || !info || info.parentID || info.id !== route.sessionID) return;
      const id = info.id;
      if (id === selected) return;
      selected = id;
      const pending = histories.get(id) ?? [];
      const end = terminal(pending);
      // A fast turn may finish while metadata loads in this SAME native selection.
      // An idle/background completion from any earlier selection is not a new Done.
      const replay = !end || end.selectionEpoch === selectionEpoch ? [...pending] : [];
      enqueue(async () => {
        if (bound && bound !== id) await emit('session_replaced', { scope: 'root', sessionId: id,
          previousSessionId: bound, nativeEvent: 'tui.session.selected' });
        else await emit('session_started', { scope: 'root', sessionId: id, nativeEvent: 'tui.session.selected' });
        bound = id;
        for (const event of replay) await observe(event, true);
      });
    });
    const stop = ctx.data.listen(({ details }) => {
      if (!relevant(details.type) && !['session.created', 'session.moved', 'session.deleted'].includes(details.type)) return;
      const route = readRoute();
      const event = project(details);
      const foreground = foregroundFor(route, idOf(event));
      if (route.type === 'session' && route.sessionID === idOf(event)) event.selectionEpoch = selectionEpoch;
      remember(event);
      enqueue(async () => {
        const deletedBoundRoot = event.type === 'session.deleted' && idOf(event) === bound;
        await observe(event, foreground || deletedBoundRoot);
        if (event.type === 'session.deleted') histories.delete(idOf(event));
        if (deletedBoundRoot) {
          bound = undefined;
          if (selected === idOf(event)) selected = undefined;
        }
      });
    });
    return () => { if (disposed) return; disposed = true; stop(); histories.clear(); };
  },
};
`;
