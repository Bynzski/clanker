import { afterEach, expect, it, vi } from 'vitest';
import { AssistantAttentionObserver } from '../../../src/main/assistants/assistantAttention';
import { FakeSocket } from '../../_helpers/fakeHermes';

function setup() {
  const sockets: FakeSocket[] = [];
  const changed = vi.fn();
  const observer = new AssistantAttentionObserver('ws://localhost/api/events?channel=test', 'stored-root', (url) => {
    const socket = new FakeSocket(url); sockets.push(socket); return socket;
  }, changed);
  const send = (type: string, payload?: object, sid = 'runtime-root', socket = sockets[sockets.length - 1]) => socket.emit('message', {
    data: JSON.stringify({ method: 'event', params: { type, session_id: sid, payload } }),
  });
  const bind = () => send('session.info', { stored_session_id: 'stored-root', running: false });
  return { sockets, changed, observer, send, bind };
}
afterEach(() => vi.useRealTimers());

it('binds only the canonical root, projects lifecycle and ignores child turns and terminal text', () => {
  const { observer, changed, send, bind, sockets } = setup();
  send('message.start'); expect(changed).not.toHaveBeenCalled();
  send('session.info', { stored_session_id: 'other', running: true }); expect(changed).not.toHaveBeenCalled();
  bind(); expect(changed).toHaveBeenLastCalledWith('idle');
  send('message.start'); expect(changed).toHaveBeenLastCalledWith('working');
  send('message.complete', { status: 'complete' }, 'child'); expect(changed).toHaveBeenLastCalledWith('working');
  sockets[0].emit('message', { data: 'Working... Finished' }); expect(changed).toHaveBeenLastCalledWith('working');
  send('message.complete', { status: 'complete', text: 'secret' }); expect(changed).toHaveBeenLastCalledWith('finished');
  send('session.info', { stored_session_id: 'stored-root', running: false }); expect(changed).toHaveBeenLastCalledWith('finished');
  send('session.info', { stored_session_id: 'stored-root', running: true }); expect(changed).toHaveBeenLastCalledWith('working');
  send('message.complete', { status: 'error' }); expect(changed).toHaveBeenLastCalledWith('error');
  send('message.complete', { status: 'interrupted' }); expect(changed).toHaveBeenLastCalledWith('idle');
  observer.dispose();
});

it('recognizes mirrored resume identity and waits for every human request to settle', () => {
  const { observer, changed, send, sockets } = setup();
  sockets[0].emit('message', { data: JSON.stringify({ id: 1, result: { session_id: 'runtime-root', info: { stored_session_id: 'stored-root', running: true } } }) });
  expect(changed).toHaveBeenLastCalledWith('working');
  for (const id of ['a', 'b']) sockets[0].emit('message', { data: JSON.stringify({ id, method: 'approval', params: { session_id: 'runtime-root', command: 'secret' } }) });
  expect(changed).toHaveBeenLastCalledWith('needs-input');
  send('request.cancel', { id: 'a' }); expect(changed).toHaveBeenLastCalledWith('needs-input');
  send('request.cancel', { id: 'b' }); expect(changed).toHaveBeenLastCalledWith('working');
  expect(JSON.stringify(changed.mock.calls)).not.toContain('secret');
  observer.dispose();
});

it.each(['approval', 'clarify', 'sudo', 'secret', 'vault.unlock_prompt', 'vault.save_login', 'vault.code'])(
  'tracks root %s prompts until all requests are cancelled', (method) => {
    const { observer, changed, send, bind, sockets } = setup();
    const request = (id: string, session_id = 'runtime-root') => sockets[0].emit('message', {
      data: JSON.stringify({ id, method, params: { session_id, prompt: 'private prompt' } }),
    });
    bind(); send('message.start');
    request('child-request', 'child');
    expect(changed).toHaveBeenLastCalledWith('working');
    request('first');
    expect(changed).toHaveBeenLastCalledWith('needs-input');
    request('second');
    send('request.cancel', { id: 'first' }, 'child');
    send('request.cancel', { id: 'second' });
    expect(changed).toHaveBeenLastCalledWith('needs-input');
    send('request.cancel', { id: 'untracked' });
    expect(changed).toHaveBeenLastCalledWith('needs-input');
    send('request.cancel', { id: 'first' });
    expect(changed).toHaveBeenLastCalledWith('working');
    expect(JSON.stringify(changed.mock.calls)).not.toContain('private prompt');
    observer.dispose();
  },
);

it('ignores unknown request methods and malformed native request IDs', () => {
  const { observer, changed, send, bind, sockets } = setup();
  bind(); send('message.start');
  for (const [method, id] of [['vault.unknown', 'a'], ['sudo', 1], ['secret', 'x'.repeat(257)]]) {
    sockets[0].emit('message', { data: JSON.stringify({ id, method, params: { session_id: 'runtime-root' } }) });
  }
  expect(changed.mock.calls).toEqual([['idle'], ['working']]);
  observer.dispose();
});

it('clears on disconnect, reconnects without declaring completion, and rejects old sockets', async () => {
  vi.useFakeTimers();
  const { observer, changed, send, sockets, bind } = setup();
  sockets[0].emit('open'); await observer.ready; bind(); send('message.start');
  sockets[0].close(); expect(changed).toHaveBeenLastCalledWith('unknown');
  await vi.advanceTimersByTimeAsync(5000);
  expect(sockets).toHaveLength(2);
  send('message.complete', { status: 'complete' }, 'runtime-root', sockets[0]);
  expect(changed).toHaveBeenLastCalledWith('unknown');
  sockets[1].emit('open'); send('message.start'); expect(changed).toHaveBeenLastCalledWith('working');
  observer.dispose(); expect(sockets[1].closed).toBe(true);
  await vi.advanceTimersByTimeAsync(10000); expect(sockets).toHaveLength(2);
});

it('bounds frames and connection waits without blocking the PTY indefinitely', async () => {
  vi.useFakeTimers();
  const { observer, sockets, bind, send, changed } = setup();
  await vi.advanceTimersByTimeAsync(5000); await observer.ready;
  await vi.advanceTimersByTimeAsync(5000); sockets[1].emit('open'); bind(); send('message.start');
  sockets[1].emit('message', { data: 'x'.repeat(1024 * 1024 + 1) });
  expect(changed).toHaveBeenLastCalledWith('unknown'); expect(sockets[1].closed).toBe(true);
  observer.dispose();
});

it('expires a silently lost publisher without inventing completion', async () => {
  vi.useFakeTimers();
  const { observer, sockets, bind, send, changed } = setup();
  sockets[0].emit('open'); bind(); send('message.start');
  await vi.advanceTimersByTimeAsync(120_000);
  expect(changed).toHaveBeenLastCalledWith('unknown');
  send('message.delta', { text: 'private' }); expect(changed).toHaveBeenLastCalledWith('working');
  observer.dispose();
});
