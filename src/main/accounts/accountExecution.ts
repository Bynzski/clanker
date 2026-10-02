import type {
  HarnessCommandExecutor,
  HarnessCommandRequest,
  HarnessCommandSession,
  HarnessCommandSessionExecutor,
} from '../harnesses/commandExecution';
import type { WorkspaceEnvironment } from '../environment/workspaceEnvironment';

export interface BoundHarnessExecution {
  readonly executor: HarnessCommandExecutor;
  readonly sessionExecutor?: HarnessCommandSessionExecutor;
  /** Reaps every session opened through this binding, however the caller ends. */
  disposeSessions(): Promise<void>;
}

/**
 * The one place a harness command is bound to an environment (and optionally to an account
 * environment). Providers receive only these executors, so WHERE/HOW stays with the environment
 * and the account variables never pass through provider or renderer code.
 *
 * With no account environment the request is forwarded untouched, which keeps default-account
 * execution byte-for-byte what it was before accounts existed. Account variables are applied last so
 * a provider request cannot override them.
 */
export function bindHarnessExecution(
  environment: Pick<WorkspaceEnvironment, 'executeHarnessCommand' | 'openHarnessCommandSession'>,
  accountEnvironment: Readonly<Record<string, string>> | undefined,
  signal: AbortSignal,
): BoundHarnessExecution {
  const bind = (request: HarnessCommandRequest): HarnessCommandRequest => (
    accountEnvironment && Object.keys(accountEnvironment).length > 0
      ? { ...request, env: { ...request.env, ...accountEnvironment } }
      : request
  );
  const execute = environment.executeHarnessCommand?.bind(environment);
  const openSession = environment.openHarnessCommandSession?.bind(environment);
  const sessions = new Set<HarnessCommandSession>();
  return {
    executor: { run: (request) => {
      if (!execute) return Promise.reject(new Error('This environment cannot run harness commands'));
      return execute(bind(request), signal);
    } },
    ...(openSession ? {
      sessionExecutor: {
        open: async (request) => {
          const session = await openSession(bind(request), signal);
          sessions.add(session);
          return session;
        },
      } satisfies HarnessCommandSessionExecutor,
    } : {}),
    disposeSessions: async () => { await Promise.allSettled([...sessions].map((session) => session.dispose())); sessions.clear(); },
  };
}
