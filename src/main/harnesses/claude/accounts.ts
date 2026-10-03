import {
  HarnessCapabilityError,
  type HarnessAccountAuthContext,
  type HarnessAccountExecutionContext,
  type HarnessAccountIdentity,
  type HarnessAccountsCapability,
} from '../types';
import { claudePlanLabel } from './usage';

/**
 * Claude accounts through the supported CLI auth surface (claude 2.1.288): `claude auth login`
 * (opens the system browser itself), `claude auth status --json` and `claude auth logout`, all run
 * with `CLAUDE_CONFIG_DIR` set to a Clanker-owned home. Claude documents that variable as relocating
 * settings, session history and plugins for running multiple accounts side by side, so a managed
 * session must use the same directory for its whole lifetime.
 *
 * Nothing here types `/login` into a TUI, scrapes terminal output, or touches OAuth tokens. The login
 * process's stdout/stderr can carry the sign-in URL, so it is drained and discarded, never logged or
 * forwarded. `auth status` can refresh credentials, so it runs only at lifecycle points (after login),
 * never on a timer.
 */
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const STATUS_ARGS = ['auth', 'status', '--json'];

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/** Exit status is not meaningful for `auth status` (signed-out exits 1 with valid JSON), so stdout decides. */
function parseStatus(stdout: string): HarnessAccountIdentity {
  let parsed: unknown;
  try { parsed = JSON.parse(stdout); } catch (error) { throw new HarnessCapabilityError('parse-failure', 'claude auth status did not produce valid JSON', error); }
  if (!isObject(parsed) || typeof parsed.loggedIn !== 'boolean') throw new HarnessCapabilityError('parse-failure', 'claude auth status returned an unexpected shape');
  if (!parsed.loggedIn) throw new HarnessCapabilityError('unauthenticated', 'claude is not signed in');
  const provider = str(parsed.apiProvider);
  if (provider && provider !== 'firstParty') throw new HarnessCapabilityError('unsupported', 'claude is using a third-party provider');
  return { email: str(parsed.email), plan: claudePlanLabel(str(parsed.subscriptionType)) };
}

async function verify(context: HarnessAccountExecutionContext): Promise<HarnessAccountIdentity> {
  const result = await context.executor.run({ command: 'claude', args: [...STATUS_ARGS], timeoutMs: 20_000 });
  return parseStatus(result.stdout);
}

async function authenticate(context: HarnessAccountAuthContext): Promise<HarnessAccountIdentity> {
  if (!context.sessionExecutor) throw new HarnessCapabilityError('unsupported', 'This environment cannot run interactive account sessions');
  const session = await context.sessionExecutor.open({
    command: 'claude', args: ['auth', 'login', '--claudeai'], timeoutMs: LOGIN_TIMEOUT_MS, maxOutputBytes: 256 * 1024,
  });
  try {
    context.waitingForBrowser();
    await session.closeInput(); // the browser callback completes login; never wait on a pasted code
    // Drain and discard: the stream may contain the sign-in URL.
    const drain = (async () => { while ((await session.readLine()) !== null) { /* discard */ } })().catch(() => undefined);
    const aborted = new Promise<never>((_, reject) => {
      const onAbort = () => reject(new HarnessCapabilityError('aborted', 'Sign-in was cancelled'));
      if (context.signal.aborted) onAbort(); else context.signal.addEventListener('abort', onAbort, { once: true });
    });
    const exit = await Promise.race([session.wait(), aborted]);
    await drain;
    if (exit.exitCode !== 0) throw new HarnessCapabilityError('unauthenticated', 'claude sign-in did not complete');
    // Verify under the same CLAUDE_CONFIG_DIR before the account counts as connected.
    return await verify(context);
  } finally {
    await session.dispose();
  }
}

async function logout(context: HarnessAccountExecutionContext): Promise<void> {
  const result = await context.executor.run({ command: 'claude', args: ['auth', 'logout'], timeoutMs: 20_000 });
  if (result.exitCode === 0) return;
  // A failed logout is acceptable only if status proves nothing is signed in (it throws `unauthenticated`).
  await verify(context).then(
    () => { throw new HarnessCapabilityError('command-failed', 'claude auth logout failed'); },
    (error: unknown) => { if (!(error instanceof HarnessCapabilityError && error.kind === 'unauthenticated')) throw error; },
  );
}

export const claudeAccounts: HarnessAccountsCapability = {
  environment: (home) => ({ CLAUDE_CONFIG_DIR: home }),
  authenticate,
  verify,
  logout,
  discoverSessions: async (workspacePath, home) => (await import('./sessions')).discoverClaudeSessions(workspacePath, home),
};
