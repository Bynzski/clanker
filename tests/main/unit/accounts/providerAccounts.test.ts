import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { codexAccounts } from '../../../../src/main/harnesses/codex/accounts';
import { claudeAccounts } from '../../../../src/main/harnesses/claude/accounts';
import { HarnessCapabilityError, type HarnessAccountAuthContext } from '../../../../src/main/harnesses/types';
import type { HarnessCommandRequest, HarnessCommandSession } from '../../../../src/main/harnesses/commandExecution';
import { bindHarnessExecution } from '../../../../src/main/accounts/accountExecution';

type Json = Record<string, unknown>;

/** Scripted JSON-RPC peer standing in for `codex app-server`. */
function fakeAppServer(handler: (message: Json, push: (message: Json) => void) => void) {
  const written: Json[] = [];
  const lines: string[] = [];
  const readers: Array<(line: string | null) => void> = [];
  let closed = false;
  const reads = { active: 0, max: 0 };
  const push = (message: Json) => {
    const line = JSON.stringify(message);
    const reader = readers.shift();
    if (reader) reader(line); else lines.push(line);
  };
  const session: HarnessCommandSession = {
    writeLine: vi.fn(async (line: string) => { const message = JSON.parse(line) as Json; written.push(message); handler(message, push); }),
    readLine: vi.fn(() => {
      reads.active++;
      reads.max = Math.max(reads.max, reads.active);
      return new Promise<string | null>((resolve) => {
        const finish = (line: string | null) => { reads.active--; resolve(line); };
        const next = lines.shift();
        if (next !== undefined) finish(next); else if (closed) finish(null); else readers.push(finish);
      });
    }),
    closeInput: vi.fn(async () => undefined),
    wait: vi.fn(async () => ({ stderr: '', exitCode: 0 })),
    dispose: vi.fn(async () => { closed = true; for (const reader of readers.splice(0)) reader(null); }),
  };
  return { session, written, push, reads };
}

const clientInfo = { name: 'clanker-grid', title: 'Clanker Grid', version: 'test' };
function context(over: Partial<HarnessAccountAuthContext> & { session?: HarnessCommandSession; requests?: HarnessCommandRequest[] }): HarnessAccountAuthContext {
  return {
    executor: { run: vi.fn() }, signal: new AbortController().signal, clientInfo,
    openUrl: vi.fn(), waitingForBrowser: vi.fn(),
    sessionExecutor: { open: vi.fn(async (request) => { over.requests?.push(request); return over.session!; }) },
    ...over,
  } as HarnessAccountAuthContext;
}

const CHATGPT = { type: 'chatgpt', email: 'me@example.test', planType: 'plus' };
const standard = (loginId = 'login-1', account: Json | null = CHATGPT) => (message: Json, push: (m: Json) => void) => {
  if (message.method === 'initialize') push({ id: message.id, result: { userAgent: 'codex' } });
  if (message.method === 'account/login/start') push({ id: message.id, result: { type: 'chatgpt', loginId, authUrl: 'https://auth.openai.example/oauth?state=abc' } });
  if (message.method === 'account/read') push({ id: message.id, result: { account, requiresOpenaiAuth: true } });
  if (message.method === 'account/logout') push({ id: message.id, result: {} });
  if (message.method === 'account/login/cancel') push({ id: message.id, result: { status: 'canceled' } });
};

describe('Codex managed account authentication (app-server)', () => {
  it('binds the account through CODEX_HOME only', () => {
    expect(codexAccounts.environment('/owned/home')).toEqual({ CODEX_HOME: '/owned/home' });
  });

  it('initialize → initialized → login/start → matching login/completed → account/read, with no model request', async () => {
    const server = fakeAppServer(standard());
    const requests: HarnessCommandRequest[] = [];
    const ctx = context({ session: server.session, requests });
    const pending = codexAccounts.authenticate(ctx);
    await vi.waitFor(() => expect(ctx.waitingForBrowser).toHaveBeenCalled());
    // A completion for some other login must be ignored; only the matching loginId counts.
    server.push({ method: 'account/login/completed', params: { loginId: 'someone-else', success: true } });
    server.push({ method: 'account/updated', params: {} });
    server.push({ method: 'account/login/completed', params: { loginId: 'login-1', success: true, error: null } });
    await expect(pending).resolves.toEqual({ email: 'me@example.test', plan: 'plus' });

    expect(server.written.map((m) => m.method)).toEqual(['initialize', 'initialized', 'account/login/start', 'account/read']);
    expect(server.written.find((m) => m.method === 'account/login/start')?.params).toEqual({ type: 'chatgpt' });
    expect(server.written.find((m) => m.method === 'account/read')?.params).toEqual({ refreshToken: false });
    expect(server.written.some((m) => /thread|turn|model|chat/i.test(String(m.method)))).toBe(false);
    expect(ctx.openUrl).toHaveBeenCalledExactlyOnceWith('https://auth.openai.example/oauth?state=abc');
    expect(requests[0]).toMatchObject({ command: 'codex', args: ['app-server'] });
    expect(server.session.dispose).toHaveBeenCalled();
  });

  it('a failed completion is an unauthenticated failure, not a connected account', async () => {
    const server = fakeAppServer(standard());
    const ctx = context({ session: server.session });
    const pending = codexAccounts.authenticate(ctx);
    await vi.waitFor(() => expect(ctx.waitingForBrowser).toHaveBeenCalled());
    server.push({ method: 'account/login/completed', params: { loginId: 'login-1', success: false, error: 'access_denied sk-SECRET' } });
    const error = await pending.catch((e) => e as HarnessCapabilityError);
    expect(error).toMatchObject({ kind: 'unauthenticated' });
    expect(String((error as Error).message)).not.toContain('SECRET');
    expect(server.written.some((m) => m.method === 'account/read')).toBe(false);
  });

  it('only a usable ChatGPT account counts as connected', async () => {
    const server = fakeAppServer(standard('login-1', { type: 'apiKey' }));
    const ctx = context({ session: server.session });
    const pending = codexAccounts.authenticate(ctx);
    await vi.waitFor(() => expect(ctx.waitingForBrowser).toHaveBeenCalled());
    server.push({ method: 'account/login/completed', params: { loginId: 'login-1', success: true } });
    await expect(pending).rejects.toMatchObject({ kind: 'unsupported' });
  });

  it('cancellation sends account/login/cancel for the active login ID, then disposes the app-server', async () => {
    const server = fakeAppServer(standard('login-42'));
    const controller = new AbortController();
    const ctx = context({ session: server.session, signal: controller.signal });
    const pending = codexAccounts.authenticate(ctx);
    await vi.waitFor(() => expect(ctx.waitingForBrowser).toHaveBeenCalled());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
    const cancel = server.written.find((m) => m.method === 'account/login/cancel');
    expect(cancel?.params).toEqual({ loginId: 'login-42' });
    expect(server.session.dispose).toHaveBeenCalled();
    // The cancel was answered and the answer reached its request: nothing was left waiting or stolen.
    expect(server.written.filter((m) => m.method === 'account/login/cancel')).toHaveLength(1);
  });

  it('never has more than one concurrent reader, including across cancellation', async () => {
    const full = fakeAppServer(standard());
    const ctx = context({ session: full.session });
    const pending = codexAccounts.authenticate(ctx);
    await vi.waitFor(() => expect(ctx.waitingForBrowser).toHaveBeenCalled());
    for (const method of ['account/updated', 'remoteControl/status/changed', 'account/login/completed']) {
      full.push({ method, params: method === 'account/login/completed' ? { loginId: 'login-1', success: true } : {} });
    }
    await pending;
    expect(full.reads.max).toBe(1);

    const cancelled = fakeAppServer(standard('login-7'));
    const controller = new AbortController();
    const cancelCtx = context({ session: cancelled.session, signal: controller.signal });
    const abortedLogin = codexAccounts.authenticate(cancelCtx);
    await vi.waitFor(() => expect(cancelCtx.waitingForBrowser).toHaveBeenCalled());
    cancelled.push({ method: 'account/updated', params: {} });
    controller.abort();
    await expect(abortedLogin).rejects.toMatchObject({ kind: 'aborted' });
    expect(cancelled.reads.max).toBe(1);
    expect(cancelled.written.map((m) => m.method)).toContain('account/login/cancel');
  });

  it('a completion that races ahead of the login/start response is not lost', async () => {
    const server = fakeAppServer((message, push) => {
      if (message.method === 'account/login/start') {
        push({ method: 'account/login/completed', params: { loginId: 'login-1', success: true } });
        push({ id: message.id, result: { type: 'chatgpt', loginId: 'login-1', authUrl: 'https://auth.example.test/x' } });
      } else standard()(message, push);
    });
    await expect(codexAccounts.authenticate(context({ session: server.session }))).resolves.toEqual({ email: 'me@example.test', plan: 'plus' });
  });

  it('still reaps the app-server when the cancel RPC itself fails or never answers', async () => {
    const failing = fakeAppServer((message, push) => {
      if (message.method === 'account/login/cancel') push({ id: message.id, error: { code: -1, message: 'nope /home/x' } });
      else standard('login-9')(message, push);
    });
    const controller = new AbortController();
    const ctx = context({ session: failing.session, signal: controller.signal });
    const pending = codexAccounts.authenticate(ctx);
    await vi.waitFor(() => expect(ctx.waitingForBrowser).toHaveBeenCalled());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
    expect(failing.session.dispose).toHaveBeenCalled();

    vi.useFakeTimers();
    try {
      const silent = fakeAppServer((message, push) => { if (message.method !== 'account/login/cancel') standard('login-9')(message, push); });
      const second = new AbortController();
      const silentCtx = context({ session: silent.session, signal: second.signal });
      const stuck = codexAccounts.authenticate(silentCtx).catch((error: unknown) => error);
      await vi.waitFor(() => expect(silentCtx.waitingForBrowser).toHaveBeenCalled());
      second.abort();
      await vi.advanceTimersByTimeAsync(2000);
      expect(await stuck).toMatchObject({ kind: 'aborted' });
      expect(silent.session.dispose).toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('cancelling before a login ID exists just stops and reaps the app-server', async () => {
    const server = fakeAppServer((message, push) => { if (message.method === 'initialize') push({ id: message.id, result: {} }); });
    const controller = new AbortController();
    const pending = codexAccounts.authenticate(context({ session: server.session, signal: controller.signal }));
    await vi.waitFor(() => expect(server.written.some((m) => m.method === 'account/login/start')).toBe(true));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
    expect(server.written.some((m) => m.method === 'account/login/cancel')).toBe(false);
    expect(server.session.dispose).toHaveBeenCalled();
  });

  it('verify and logout use the same structured API under the bound home', async () => {
    const server = fakeAppServer(standard());
    const ctx = context({ session: server.session });
    await expect(codexAccounts.verify(ctx)).resolves.toEqual({ email: 'me@example.test', plan: 'plus' });
    const logoutServer = fakeAppServer(standard());
    await codexAccounts.logout(context({ session: logoutServer.session }));
    expect(logoutServer.written.map((m) => m.method)).toEqual(['initialize', 'initialized', 'account/logout']);

    const signedOut = fakeAppServer(standard('login-1', null));
    await expect(codexAccounts.verify(context({ session: signedOut.session }))).rejects.toMatchObject({ kind: 'unauthenticated' });
  });

  it('RPC error text never escapes (it can carry paths, URLs or tokens)', async () => {
    const server = fakeAppServer((message, push) => {
      if (message.method === 'initialize') push({ id: message.id, error: { code: -1, message: 'boom /home/me/.codex token=sk-LEAK' } });
    });
    const error = await codexAccounts.verify(context({ session: server.session })).catch((e: Error) => e) as Error;
    expect(error.message).not.toMatch(/LEAK|\.codex/);
  });

  it('does not hardcode credential-file storage: the provider never mentions auth.json or forces a store mode', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../../src/main/harnesses/codex/accounts.ts'), 'utf8')
      .split('\n').filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//')).join('\n');
    expect(source).not.toMatch(/auth\.json|cli_auth_credentials_store|keyring|readFile|writeFile|fs\./i);
  });

  it('discovers sessions with the same parser against the supplied home', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-'));
    try {
      expect(await codexAccounts.discoverSessions('/nowhere', home)).toEqual([]);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
});

describe('Claude managed account authentication (CLI)', () => {
  const status = (over: Json = {}) => JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'me@example.test', subscriptionType: 'max', projectsDirectory: '/owned/projects', configDirectory: '/owned', ...over });

  it('binds the account through CLAUDE_CONFIG_DIR only', () => {
    expect(claudeAccounts.environment('/owned/home')).toEqual({ CLAUDE_CONFIG_DIR: '/owned/home' });
  });

  function loginSession(exitCode: number, onLine?: (line: string) => void) {
    const chunks = ['Opening browser to sign in…', 'If the browser didn\'t open, visit: https://claude.example/oauth?code=SECRET'];
    let index = 0;
    const session: HarnessCommandSession = {
      writeLine: vi.fn(), closeInput: vi.fn(async () => undefined),
      readLine: vi.fn(async () => { const line = chunks[index++] ?? null; if (line) onLine?.(line); return line; }),
      wait: vi.fn(async () => ({ stderr: '', exitCode })), dispose: vi.fn(async () => undefined),
    };
    return session;
  }

  it('runs `claude auth login` then verifies with `claude auth status --json` under the same environment, with no model request', async () => {
    const executed: HarnessCommandRequest[] = [];
    const opened: HarnessCommandRequest[] = [];
    const session = loginSession(0);
    const environment = {
      executeHarnessCommand: vi.fn(async (request: HarnessCommandRequest) => { executed.push(request); return { stdout: status(), stderr: '', exitCode: 0 }; }),
      openHarnessCommandSession: vi.fn(async (request: HarnessCommandRequest) => { opened.push(request); return session; }),
    };
    const bound = bindHarnessExecution(environment, claudeAccounts.environment('/owned/claude-home'), new AbortController().signal);
    const ctx = { ...context({}), executor: bound.executor, sessionExecutor: bound.sessionExecutor } as HarnessAccountAuthContext;
    await expect(claudeAccounts.authenticate(ctx)).resolves.toEqual({ email: 'me@example.test', plan: 'Max' });
    expect(opened[0]).toMatchObject({ command: 'claude', args: ['auth', 'login', '--claudeai'], env: { CLAUDE_CONFIG_DIR: '/owned/claude-home' } });
    expect(executed).toEqual([expect.objectContaining({ command: 'claude', args: ['auth', 'status', '--json'], env: { CLAUDE_CONFIG_DIR: '/owned/claude-home' } })]);
    expect(ctx.waitingForBrowser).toHaveBeenCalled();
    expect(ctx.openUrl).not.toHaveBeenCalled(); // the CLI opens the browser itself
    expect(session.writeLine).not.toHaveBeenCalled(); // never types /login or anything else into it
    expect(session.dispose).toHaveBeenCalled();
    for (const request of [...opened, ...executed]) expect(request.args).not.toContain('--print');
  });

  it('never forwards the login process output (it contains the sign-in URL)', async () => {
    const seen: string[] = [];
    const session = loginSession(0, (line) => seen.push(line));
    const ctx = context({ session });
    (ctx.executor.run as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ stdout: status(), stderr: '', exitCode: 0 });
    const identity = await claudeAccounts.authenticate(ctx);
    expect(seen.length).toBe(2); // drained
    expect(JSON.stringify(identity)).not.toContain('SECRET');
    expect(ctx.openUrl).not.toHaveBeenCalled();
  });

  it('a non-zero login exit, or a signed-out status, is not a connected account', async () => {
    const failed = context({ session: loginSession(1) });
    await expect(claudeAccounts.authenticate(failed)).rejects.toMatchObject({ kind: 'unauthenticated' });
    expect(failed.executor.run).not.toHaveBeenCalled();

    const ctx = context({ session: loginSession(0) });
    (ctx.executor.run as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ stdout: status({ loggedIn: false, email: undefined }), stderr: '', exitCode: 1 });
    await expect(claudeAccounts.authenticate(ctx)).rejects.toMatchObject({ kind: 'unauthenticated' });
  });

  it('cancellation rejects as aborted and disposes the login process', async () => {
    const never: HarnessCommandSession = {
      writeLine: vi.fn(), closeInput: vi.fn(async () => undefined), readLine: vi.fn(() => new Promise<string | null>(() => undefined)),
      wait: vi.fn(() => new Promise<{ stderr: string; exitCode: number }>(() => undefined)), dispose: vi.fn(async () => undefined),
    };
    const controller = new AbortController();
    const pending = claudeAccounts.authenticate(context({ session: never, signal: controller.signal }));
    await vi.waitFor(() => expect(never.closeInput).toHaveBeenCalled());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
    expect(never.dispose).toHaveBeenCalled();
  });

  it('verify parses JSON from stdout even though signed-out exits 1, and rejects third-party providers and bad shapes', async () => {
    const run = (stdout: string) => claudeAccounts.verify({ ...context({}), executor: { run: vi.fn(async () => ({ stdout, stderr: '', exitCode: 1 })) } });
    await expect(run(status({ loggedIn: false }))).rejects.toMatchObject({ kind: 'unauthenticated' });
    await expect(run(status({ apiProvider: 'bedrock' }))).rejects.toMatchObject({ kind: 'unsupported' });
    await expect(run('not json')).rejects.toMatchObject({ kind: 'parse-failure' });
    await expect(run('{"loggedIn":"yes"}')).rejects.toMatchObject({ kind: 'parse-failure' });
    await expect(run(status())).resolves.toEqual({ email: 'me@example.test', plan: 'Max' });
  });

  it('logout runs `claude auth logout` under the bound environment', async () => {
    const run = vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 }));
    await claudeAccounts.logout({ ...context({}), executor: { run } });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ command: 'claude', args: ['auth', 'logout'] }));
  });

  it('a failed logout is accepted only when status proves nothing is signed in', async () => {
    const make = (statusOut: string) => ({ ...context({}), executor: { run: vi.fn(async (request: HarnessCommandRequest) =>
      request.args?.[1] === 'logout' ? { stdout: '', stderr: '', exitCode: 2 } : { stdout: statusOut, stderr: '', exitCode: 1 }) } });
    await expect(claudeAccounts.logout(make(status({ loggedIn: false })))).resolves.toBeUndefined();
    await expect(claudeAccounts.logout(make(status()))).rejects.toMatchObject({ kind: 'command-failed' });
    await expect(claudeAccounts.logout(make('garbage'))).rejects.toMatchObject({ kind: 'parse-failure' });
  });
});

describe('account-bound execution', () => {
  it('leaves requests untouched without an account environment, and applies account variables last otherwise', async () => {
    const execute = vi.fn<(request: HarnessCommandRequest, signal?: AbortSignal) => Promise<{ stdout: string; stderr: string; exitCode: number }>>(async () => ({ stdout: '', stderr: '', exitCode: 0 }));
    const env = { executeHarnessCommand: execute, openHarnessCommandSession: vi.fn() };
    const signal = new AbortController().signal;
    const request = { command: 'x', env: { A: '1' } };
    await bindHarnessExecution(env, undefined, signal).executor.run(request);
    expect(execute).toHaveBeenLastCalledWith(request, signal);
    expect(execute.mock.calls[0][0]).toBe(request);
    await bindHarnessExecution(env, {}, signal).executor.run(request);
    expect(execute.mock.calls[1][0]).toBe(request);
    await bindHarnessExecution(env, { CODEX_HOME: '/owned' }, signal).executor.run({ command: 'x', env: { CODEX_HOME: '/attacker', A: '1' } });
    expect(execute.mock.calls[2][0]).toEqual({ command: 'x', env: { CODEX_HOME: '/owned', A: '1' } });
  });
});
