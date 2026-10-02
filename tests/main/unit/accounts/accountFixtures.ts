import { vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getHarnessProvider } from '../../../../src/main/harnesses/registry';
import type { HarnessAccountsCapability, HarnessProvider } from '../../../../src/main/harnesses/types';
import type { HarnessSession } from '../../../../src/shared/types/session';
import { AccountHomeStore } from '../../../../src/main/accounts/accountHomes';
import { MemoryAccountStorage, type HarnessAccountRegistryState } from '../../../../src/main/accounts/accountStorage';
import { HarnessAccountService, type HarnessAccountServiceOptions } from '../../../../src/main/accounts/harnessAccountService';
import type { WorkspaceEnvironment } from '../../../../src/main/environment/workspaceEnvironment';

export function tempRoot(label = 'clanker-accounts-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), label));
}

export type FakeCapability = HarnessAccountsCapability & {
  authenticate: ReturnType<typeof vi.fn>;
  verify: ReturnType<typeof vi.fn>;
  logout: ReturnType<typeof vi.fn>;
  discoverSessions: ReturnType<typeof vi.fn>;
};

/** A provider-shaped capability with controllable authentication and a distinct env variable name. */
export function fakeCapability(variable: string, overrides: Partial<HarnessAccountsCapability> = {}): FakeCapability {
  return {
    environment: (home: string) => ({ [variable]: home }),
    authenticate: vi.fn(async (context) => {
      context.waitingForBrowser();
      context.openUrl('https://auth.example.test/login');
      return { email: 'person@example.test', plan: 'Pro' };
    }),
    verify: vi.fn(async () => ({ email: 'person@example.test', plan: 'Pro' })),
    logout: vi.fn(async () => undefined),
    discoverSessions: vi.fn(async (): Promise<HarnessSession[]> => []),
    ...overrides,
  } as FakeCapability;
}

export interface Harness {
  root: string;
  homes: AccountHomeStore;
  storage: MemoryAccountStorage;
  service: HarnessAccountService;
  capabilities: { codex: FakeCapability; claude: FakeCapability };
  openExternal: ReturnType<typeof vi.fn>;
  authEvents: unknown[];
  nextId: () => string;
  /** A fresh service over the same storage, homes and providers (an app restart). */
  restart: () => HarnessAccountService;
}

/** Storage whose writes can be made to fail, the way a full disk or locked config file would. */
export class FlakyStorage extends MemoryAccountStorage {
  public failing = false;
  public saves = 0;
  save(state: HarnessAccountRegistryState): void {
    if (this.failing) throw new Error('EACCES: permission denied, open \'/home/me/.config/clanker/harness-accounts.json\'');
    this.saves++;
    super.save(state);
  }
}

/** Real codex/claude providers with their account capabilities replaced by controllable fakes. */
export function createHarness(options: { storage?: MemoryAccountStorage; capabilities?: Partial<Harness['capabilities']> } = {}): Harness {
  const root = tempRoot();
  const homes = new AccountHomeStore(path.join(root, 'harness-accounts'));
  const storage = options.storage ?? new MemoryAccountStorage();
  const capabilities = {
    codex: options.capabilities?.codex ?? fakeCapability('CODEX_HOME'),
    claude: options.capabilities?.claude ?? fakeCapability('CLAUDE_CONFIG_DIR'),
  };
  const providers: Record<string, HarnessProvider> = {
    codex: { ...getHarnessProvider('codex'), accounts: capabilities.codex },
    claude: { ...getHarnessProvider('claude'), accounts: capabilities.claude },
    opencode: getHarnessProvider('opencode'),
  };
  const openExternal = vi.fn();
  const authEvents: unknown[] = [];
  let counter = 0;
  const nextId = () => (++counter).toString(16).padStart(32, '0');
  const environment = {
    executeHarnessCommand: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    openHarnessCommandSession: vi.fn(),
  } as unknown as WorkspaceEnvironment;
  const build = () => new HarnessAccountService({
    storage, homes, getLocalEnvironment: () => environment, openExternal,
    onAuthState: (event) => { authEvents.push(event); },
    findProvider: (harness) => (typeof harness === 'string' ? providers[harness] : undefined),
    randomId: nextId,
    ...({} as Partial<HarnessAccountServiceOptions>),
  });
  return { root, homes, storage, service: build(), capabilities, openExternal, authEvents, nextId, restart: build };
}

/** Resolves once the auth flow with this ID reaches a terminal state. */
export async function settleFlow(harness: Harness, flowId: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const event = [...harness.authEvents].reverse().find((candidate) => (candidate as { flowId: string }).flowId === flowId) as
      | { state: { status: string } & Record<string, unknown> } | undefined;
    if (event && ['connected', 'failed', 'cancelled'].includes(event.state.status)) return event.state;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('flow did not settle');
}

export async function addAccount(harness: Harness, harnessId: 'codex' | 'claude', label?: string, environmentId = 'local') {
  const started = harness.service.startAdd(environmentId, harnessId, label);
  const state = await settleFlow(harness, started.flowId);
  if (state.status !== 'connected') throw new Error(`add failed: ${JSON.stringify(state)}`);
  return (state as unknown as { account: { id: string } }).account;
}

export const lastOf = <T>(items: readonly T[]): T => items[items.length - 1];
