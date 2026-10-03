import {
  HarnessCapabilityError,
  type HarnessAccountAuthContext,
  type HarnessAccountExecutionContext,
  type HarnessAccountIdentity,
  type HarnessAccountsCapability,
} from '../types';
import type { HarnessCommandSession } from '../commandExecution';
import { CODEX_APP_SERVER_COMMAND } from './usage';

/**
 * Codex accounts through the structured app-server API (verified against codex-cli 0.160.0's generated
 * JSON schema): `initialize`, `initialized`, `account/login/start` {type:"chatgpt"} ->
 * `{loginId, authUrl}`, the matching `account/login/completed` {loginId, success, error} notification,
 * `account/read`, `account/login/cancel` {loginId} and `account/logout`.
 *
 * Isolation primitive: one Clanker account = one `CODEX_HOME`. Codex derives its credential namespace
 * (file, OS keyring or other secure store) from the canonical home, so separate homes isolate accounts
 * whichever storage mode the user configured. Nothing here reads, parses, copies or forces the format of
 * any credential file, and the internal `account/sessions/*` types are deliberately not used.
 */
const MAX_MESSAGES = 4000;
const SESSION_TIMEOUT_MS = 5 * 60_000;
const SHORT_SESSION_TIMEOUT_MS = 30_000;
const CANCEL_BOUND_MS = 1500;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

class RpcFailure extends Error {}

const abortedError = () => new HarnessCapabilityError('aborted', 'Sign-in was cancelled');

/**
 * Minimal JSON-RPC peer with exactly one reader. A single pump owns `readLine()` for the whole life of
 * the process and routes responses to their requests and notifications to a queue, so requests,
 * cancellation and notification waits never read the stream themselves and can never steal each
 * other's messages. Waits are abort-aware and simply stop waiting; nothing is left reading.
 */
class AppServerClient {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private readonly notifications: Json[] = [];
  private readonly wake = new Set<() => void>();
  private failure?: Error;
  private seen = 0;

  constructor(private readonly session: HarnessCommandSession) {
    void this.pump();
  }

  private async pump(): Promise<void> {
    try {
      for (;;) {
        const line = await this.session.readLine();
        if (line === null) throw new HarnessCapabilityError('command-failed', 'codex app-server closed unexpectedly');
        if (!line.trim()) continue;
        if (++this.seen > MAX_MESSAGES) throw new HarnessCapabilityError('command-failed', 'codex app-server sent too many messages');
        let message: unknown;
        try { message = JSON.parse(line); } catch (error) { throw new HarnessCapabilityError('parse-failure', 'codex app-server sent invalid JSON', error); }
        if (!isObject(message)) throw new HarnessCapabilityError('parse-failure', 'codex app-server sent a non-object message');
        this.route(message);
      }
    } catch (error) {
      this.failure = error instanceof Error ? error : new Error(String(error));
      for (const request of this.pending.values()) request.reject(this.failure);
      this.pending.clear();
      for (const wake of [...this.wake]) wake();
    }
  }

  private route(message: Json): void {
    if (typeof message.method === 'string') {
      if (message.id === undefined) { this.notifications.push(message); for (const wake of [...this.wake]) wake(); }
      return; // server-initiated requests are never answered or acted on
    }
    const request = typeof message.id === 'number' ? this.pending.get(message.id) : undefined;
    if (!request) return;
    this.pending.delete(message.id as number);
    if (isObject(message.error)) request.reject(new RpcFailure(typeof message.error.message === 'string' ? message.error.message : 'rpc error'));
    else request.resolve(message.result);
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    if (this.failure) throw this.failure;
    const id = this.nextId++;
    const response = new Promise<unknown>((resolve, reject) => { this.pending.set(id, { resolve, reject }); });
    try {
      await this.session.writeLine(JSON.stringify({ id, method, ...(params !== undefined ? { params } : {}) }));
    } catch (error) {
      this.pending.delete(id);
      throw error;
    }
    return response;
  }

  notify(method: string): Promise<void> { return this.session.writeLine(JSON.stringify({ method })); }

  /** First notification of `method` accepted by `match`; others stay queued. Stops waiting on abort. */
  async waitForNotification(method: string, match: (params: Json) => boolean, signal: AbortSignal): Promise<Json> {
    for (;;) {
      if (signal.aborted) throw abortedError();
      const index = this.notifications.findIndex((entry) => entry.method === method && isObject(entry.params) && match(entry.params));
      if (index >= 0) return this.notifications.splice(index, 1)[0].params as Json;
      if (this.failure) throw this.failure;
      await new Promise<void>((resolve) => {
        const done = () => { this.wake.delete(done); signal.removeEventListener('abort', done); resolve(); };
        this.wake.add(done);
        signal.addEventListener('abort', done, { once: true });
      });
    }
  }

  async handshake(clientInfo: HarnessAccountExecutionContext['clientInfo']): Promise<void> {
    await this.request('initialize', { clientInfo: { name: clientInfo.name, title: clientInfo.title, version: clientInfo.version }, capabilities: null });
    await this.notify('initialized');
  }
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortedError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortedError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function toFailure(error: unknown): HarnessCapabilityError {
  if (error instanceof HarnessCapabilityError) return error;
  // The raw RPC text may hold URLs, paths or account details; classify only.
  if (error instanceof RpcFailure) return new HarnessCapabilityError('command-failed', 'codex app-server returned an error');
  return new HarnessCapabilityError('command-failed', 'codex app-server failed', error);
}

async function openAppServer(context: HarnessAccountExecutionContext, timeoutMs: number): Promise<HarnessCommandSession> {
  if (!context.sessionExecutor) throw new HarnessCapabilityError('unsupported', 'This environment cannot run interactive account sessions');
  return context.sessionExecutor.open({ ...CODEX_APP_SERVER_COMMAND, args: [...CODEX_APP_SERVER_COMMAND.args], timeoutMs, maxOutputBytes: 512 * 1024 });
}

/** `account/read` with no token refresh; only a usable ChatGPT account counts as connected. */
async function readChatGptAccount(client: AppServerClient): Promise<HarnessAccountIdentity> {
  const result = await client.request('account/read', { refreshToken: false });
  const account = isObject(result) ? result.account : undefined;
  if (account === null || account === undefined) throw new HarnessCapabilityError('unauthenticated', 'codex account is not signed in');
  if (!isObject(account) || account.type !== 'chatgpt') throw new HarnessCapabilityError('unsupported', 'codex is not using a ChatGPT account');
  return { email: str(account.email), plan: str(account.planType) };
}

async function authenticate(context: HarnessAccountAuthContext): Promise<HarnessAccountIdentity> {
  const session = await openAppServer(context, SESSION_TIMEOUT_MS);
  const client = new AppServerClient(session);
  let loginId: string | undefined;
  try {
    await raceAbort(client.handshake(context.clientInfo), context.signal);
    const started = await raceAbort(client.request('account/login/start', { type: 'chatgpt' }), context.signal);
    if (!isObject(started) || started.type !== 'chatgpt' || !str(started.loginId) || !str(started.authUrl)) {
      throw new HarnessCapabilityError('parse-failure', 'codex returned an unexpected login response');
    }
    loginId = str(started.loginId);
    context.openUrl(str(started.authUrl)!);
    context.waitingForBrowser();
    // Only the completion that carries this login's own ID counts.
    const completed = await client.waitForNotification('account/login/completed', (params) => params.loginId === loginId, context.signal);
    if (completed.success !== true) throw new HarnessCapabilityError('unauthenticated', 'codex sign-in did not complete');
    const identity = await raceAbort(readChatGptAccount(client), context.signal);
    await session.closeInput().catch(() => undefined);
    return identity;
  } catch (error) {
    if (loginId && context.signal.aborted) {
      // Best effort: ask Codex to drop the pending login before the process is reaped.
      // The pump is the only reader, so the cancel response cannot be consumed by an abandoned wait.
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        client.request('account/login/cancel', { loginId }).catch(() => undefined),
        new Promise((resolve) => { timer = setTimeout(resolve, CANCEL_BOUND_MS); }),
      ]);
      clearTimeout(timer);
    }
    throw toFailure(error);
  } finally {
    await session.dispose();
  }
}

async function verify(context: HarnessAccountExecutionContext): Promise<HarnessAccountIdentity> {
  const session = await openAppServer(context, SHORT_SESSION_TIMEOUT_MS);
  try {
    const client = new AppServerClient(session);
    await client.handshake(context.clientInfo);
    return await readChatGptAccount(client);
  } catch (error) {
    throw toFailure(error);
  } finally {
    await session.dispose();
  }
}

async function logout(context: HarnessAccountExecutionContext): Promise<void> {
  const session = await openAppServer(context, SHORT_SESSION_TIMEOUT_MS);
  try {
    const client = new AppServerClient(session);
    await client.handshake(context.clientInfo);
    await client.request('account/logout');
  } catch (error) {
    throw toFailure(error);
  } finally {
    await session.dispose();
  }
}

export const codexAccounts: HarnessAccountsCapability = {
  environment: (home) => ({ CODEX_HOME: home }),
  authenticate,
  verify,
  logout,
  discoverSessions: async (workspacePath, home) => (await import('./sessions')).discoverCodexSessions(workspacePath, home),
};
