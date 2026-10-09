import { randomBytes } from 'node:crypto';
import type { HarnessId } from '../../shared/harnessIds';
import { LOCAL_ENVIRONMENT_ID, type WorkspaceEnvironmentId } from '../../shared/types/environments';
import {
  DEFAULT_HARNESS_ACCOUNT_ID,
  HARNESS_ACCOUNT_LABEL_MAX,
  type AccountAuthState,
  type HarnessAccountAuthEvent,
  type HarnessAccountAuthStart,
  type HarnessAccountId,
  type HarnessAccountList,
  type HarnessAccountStatus,
  type SafeHarnessAccount,
} from '../../shared/types/harnessAccounts';
import type { HarnessSession } from '../../shared/types/session';
import { findHarnessProvider } from '../harnesses/registry';
import {
  HarnessCapabilityError,
  classifyHarnessFailure,
  type HarnessAccountIdentity,
  type HarnessAccountsCapability,
  type HarnessProvider,
} from '../harnesses/types';
import type { WorkspaceEnvironment } from '../environment/workspaceEnvironment';
import { normalizeExternalUrl } from '../security';
import { bindHarnessExecution } from './accountExecution';
import { AccountHomeStore, MANAGED_ACCOUNT_ID_PATTERN, UnsafeAccountPathError } from './accountHomes';
import type {
  HarnessAccountRegistryState,
  HarnessAccountStorage,
  StoredHarnessAccount,
} from './accountStorage';

export const AUTH_FLOW_TIMEOUT_MS = 5 * 60_000;
export const MAX_ACTIVE_AUTH_FLOWS = 4;
const ADD_CLEANUP_TIMEOUT_MS = 15_000;
const HARD_STOP_GRACE_MS = 3000;
export const MAX_MANAGED_ACCOUNTS_PER_HARNESS = 16;
const MAX_TEXT = 120;
const SSH_UNSUPPORTED = 'Managed accounts are not available for SSH environments yet.';

export type HarnessAccountErrorCode = 'invalid' | 'not-found' | 'unsupported' | 'needs-auth' | 'busy' | 'failed';

/** Every message is a fixed product string; it is the only error text allowed to cross IPC. */
export class HarnessAccountError extends Error {
  constructor(readonly code: HarnessAccountErrorCode, message: string) {
    super(message);
    this.name = 'HarnessAccountError';
  }
}

export interface ResolvedHarnessAccountBinding {
  readonly id: HarnessAccountId;
  readonly kind: 'default' | 'managed';
  readonly harness: HarnessId;
  readonly environmentId: WorkspaceEnvironmentId;
  readonly safe: SafeHarnessAccount;
  /** Main-only. Empty for the native/default account, which must run exactly as it always has. */
  readonly environment: Readonly<Record<string, string>>;
  mergeEnvironment<T extends Record<string, string | undefined>>(base: T): T & Record<string, string>;
  /** Set only on placeholders from `listBindings`; such a binding is never usable for execution. */
  readonly unusable?: true;
  /** Managed accounts only: the provider's own discovery run against the trusted managed home. */
  discoverSessions?(workspacePath: string): Promise<HarnessSession[]>;
}

export interface ManagedSessionDiscovery {
  /** Distinguishes cache entries whenever the managed account set changes. */
  readonly cacheKey: string;
  readonly targets: ReadonlyArray<{
    readonly harness: HarnessId;
    readonly accountId: HarnessAccountId;
    discover(workspacePath: string): Promise<HarnessSession[]>;
  }>;
}

export type HarnessAccountChange = { type: 'added' | 'removed' | 'reconnected' | 'selected'; accountId: HarnessAccountId; harness: HarnessId };

export interface HarnessAccountServiceOptions {
  storage: HarnessAccountStorage;
  homes: AccountHomeStore;
  /** Local-only in v1: managed accounts execute on this machine. */
  getLocalEnvironment: () => WorkspaceEnvironment;
  /** Receives only URLs the service has validated as http(s). */
  openExternal: (url: string) => void;
  onAuthState?: (event: HarnessAccountAuthEvent) => void;
  clientVersion?: () => string;
  findProvider?: (harness: unknown) => HarnessProvider | undefined;
  now?: () => number;
  /** 32 lowercase hex characters. */
  randomId?: () => string;
  authTimeoutMs?: number;
}

interface AuthFlow {
  id: string;
  accountId: HarnessAccountId;
  harness: HarnessId;
  environmentId: WorkspaceEnvironmentId;
  adding: boolean;
  /** Soft cancel handed to the provider so it can tidy up (e.g. cancel a pending login). */
  controller: AbortController;
  /** Hard stop for the bound processes if the provider does not wind down promptly. */
  hard: AbortController;
  cancelled: boolean;
  timedOut: boolean;
  state: AccountAuthState;
  done: Promise<void>;
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;
function sanitizeText(value: unknown, max = MAX_TEXT): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return cleaned || undefined;
}

const selectionKey = (environmentId: string, harness: string) => `${environmentId}\u0000${harness}`;
const STATUSES: readonly HarnessAccountStatus[] = ['connected', 'needs-auth', 'unknown'];

function safeInvalid(): HarnessAccountError {
  return new HarnessAccountError('invalid', 'Invalid account request');
}

/**
 * The single main-process owner of harness accounts. It holds identity, selection, persistence,
 * owned-directory allocation, auth-flow lifecycle and the launch/usage/session bindings. Provider
 * behaviour (auth protocol, account environment variable, session roots) comes only from
 * `provider.accounts`, so nothing here names a harness.
 *
 * There is deliberately no routing: a launch uses the manually selected account, a resumed session
 * uses the account that owns it, and nothing ever falls back to a different account.
 */
export class HarnessAccountService {
  private state: HarnessAccountRegistryState;
  private readonly flows = new Map<string, AuthFlow>();
  private readonly listeners = new Set<(change: HarnessAccountChange) => void>();
  private readonly now: () => number;
  private readonly findProvider: (harness: unknown) => HarnessProvider | undefined;
  private readonly authTimeoutMs: number;
  private generationCounter = 0;
  private disposed = false;

  constructor(private readonly options: HarnessAccountServiceOptions) {
    this.now = options.now ?? Date.now;
    this.findProvider = options.findProvider ?? findHarnessProvider;
    this.authTimeoutMs = options.authTimeoutMs ?? AUTH_FLOW_TIMEOUT_MS;
    this.state = this.loadState();
    this.recoverOrphanedHomes();
  }

  /** Bumps whenever the managed account set (or an account's credentials) changes. */
  public get generation(): number { return this.generationCounter; }

  public onAccountsChanged(listener: (change: HarnessAccountChange) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  // ---------------------------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------------------------

  public list(environmentId: unknown, harness: unknown): HarnessAccountList {
    const { env, id } = this.validateScope(environmentId, harness);
    const local = env === LOCAL_ENVIRONMENT_ID;
    const selected = this.selectedId(env, id);
    const accounts = [
      this.project(this.defaultRecord(id), selected),
      ...this.managedFor(env, id).map((record) => this.project(record, selected)),
    ];
    return {
      environmentId: env, harness: id, managedSupported: local,
      ...(local ? {} : { unsupportedReason: SSH_UNSUPPORTED }),
      accounts,
    };
  }

  public getSelectedAccountId(environmentId: WorkspaceEnvironmentId, harness: HarnessId): HarnessAccountId {
    return this.selectedId(environmentId, harness);
  }

  /** Managed account records for one environment, for discovery and usage orchestration. */
  public managedAccounts(environmentId: WorkspaceEnvironmentId, harness?: HarnessId): readonly StoredHarnessAccount[] {
    return this.state.accounts.filter((record) => record.environmentId === environmentId && (!harness || record.harness === harness));
  }

  // ---------------------------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------------------------

  /** Future launches only; a running terminal keeps the environment it was spawned with. */
  public select(environmentId: unknown, harness: unknown, accountId: unknown): HarnessAccountList {
    const { env, id } = this.validateScope(environmentId, harness);
    if (typeof accountId !== 'string') throw safeInvalid();
    const key = selectionKey(env, id);
    if (accountId !== DEFAULT_HARNESS_ACCOUNT_ID && !this.findManaged(env, id, accountId)) {
      throw new HarnessAccountError('not-found', 'That account is not available for this harness.');
    }
    this.commit((next) => {
      if (accountId === DEFAULT_HARNESS_ACCOUNT_ID) delete next.selections[key]; else next.selections[key] = accountId;
    });
    this.changed({ type: 'selected', accountId, harness: id });
    return this.list(env, id);
  }

  public rename(environmentId: unknown, harness: unknown, accountId: unknown, label: unknown): HarnessAccountList {
    const { env, id } = this.validateScope(environmentId, harness);
    const record = typeof accountId === 'string' ? this.findManaged(env, id, accountId) : undefined;
    if (!record) throw new HarnessAccountError('not-found', 'That account is not available for this harness.');
    if (label !== undefined && typeof label !== 'string') throw safeInvalid();
    const clean = sanitizeText(label, HARNESS_ACCOUNT_LABEL_MAX);
    this.commit((next) => {
      const target = next.accounts.find((candidate) => candidate.id === record.id)!;
      if (clean) target.label = clean; else delete target.label;
    });
    return this.list(env, id);
  }

  // ---------------------------------------------------------------------------------------------
  // Binding (launch, usage, sessions)
  // ---------------------------------------------------------------------------------------------

  /**
   * The canonical account-bound execution context. `accountId` omitted means "the selected account"
   * (fresh launches and usage); resume passes the owning account explicitly. A launch never silently
   * substitutes a different account: a missing or disconnected account is a safe, explicit error.
   */
  public resolveBinding(input: {
    environmentId: WorkspaceEnvironmentId; harness: HarnessId; accountId?: HarnessAccountId; forLaunch?: boolean;
  }): ResolvedHarnessAccountBinding {
    const { environmentId, harness } = input;
    const accountId = input.accountId ?? this.selectedId(environmentId, harness);
    if (accountId === DEFAULT_HARNESS_ACCOUNT_ID) return defaultBinding(environmentId, harness, this.selectedId(environmentId, harness) === accountId);
    // Managed accounts are local-only in v1; a remote identity never resolves a local home.
    if (environmentId !== LOCAL_ENVIRONMENT_ID) throw new HarnessAccountError('unsupported', SSH_UNSUPPORTED);
    const record = this.findManaged(environmentId, harness, accountId);
    if (!record) throw new HarnessAccountError('not-found', 'That account was removed or is no longer available. Pick another account in Settings → Harness Defaults.');
    const capability = this.capabilityFor(harness);
    if (!capability) throw new HarnessAccountError('unsupported', 'Accounts are not available for this harness.');
    if (input.forLaunch && record.status === 'needs-auth') {
      throw new HarnessAccountError('needs-auth', `${this.accountName(record)} needs to be reconnected in Settings → Harness Defaults.`);
    }
    let home: string;
    try {
      home = this.options.homes.resolve(harness, record.id);
    } catch {
      this.setStatus(record, 'needs-auth');
      throw new HarnessAccountError('needs-auth', `${this.accountName(record)} needs to be reconnected in Settings → Harness Defaults.`);
    }
    const environment = Object.freeze({ ...capability.environment(home) });
    for (const [key, value] of Object.entries(environment)) {
      if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(key) || typeof value !== 'string' || value.includes('\0')) throw new HarnessAccountError('failed', 'Account environment is invalid.');
    }
    const selected = this.selectedId(environmentId, harness) === record.id;
    return {
      id: record.id, kind: 'managed', harness, environmentId, environment,
      safe: this.project(record, selected ? record.id : DEFAULT_HARNESS_ACCOUNT_ID),
      mergeEnvironment: (base) => ({ ...base, ...environment }),
      discoverSessions: async (workspacePath) =>
        (await capability.discoverSessions(workspacePath, home)).map((session) => ({ ...session, accountId: record.id })),
    };
  }

  /** Default plus every managed account of one harness, selected first (usage orchestration). */
  public listBindings(environmentId: WorkspaceEnvironmentId, harness: HarnessId): ResolvedHarnessAccountBinding[] {
    const selected = this.selectedId(environmentId, harness);
    const ids = [DEFAULT_HARNESS_ACCOUNT_ID, ...this.managedFor(environmentId, harness).map((record) => record.id)];
    const bindings: ResolvedHarnessAccountBinding[] = [];
    for (const id of ids) {
      try {
        bindings.push(this.resolveBinding({ environmentId, harness, accountId: id }));
      } catch {
        // An unusable managed account stays visible (never silently replaced by default): usage
        // reports it as needing sign-in instead of probing it.
        const record = this.findManaged(environmentId, harness, id);
        if (record) bindings.push(unusableBinding(environmentId, harness, this.project(record, selected)));
      }
    }
    return bindings.sort((a, b) => Number(b.id === selected) - Number(a.id === selected));
  }

  /** Managed session roots for local discovery, or undefined when none exist (default-only unchanged). */
  public discoverySource(environmentId: WorkspaceEnvironmentId): ManagedSessionDiscovery | undefined {
    const records = this.managedAccounts(environmentId);
    if (records.length === 0) return undefined;
    const targets: Array<ManagedSessionDiscovery['targets'][number]> = [];
    for (const record of records) {
      let binding: ResolvedHarnessAccountBinding;
      try { binding = this.resolveBinding({ environmentId, harness: record.harness, accountId: record.id }); } catch { continue; }
      if (binding.discoverSessions) targets.push({ harness: record.harness, accountId: record.id, discover: binding.discoverSessions });
    }
    return { cacheKey: `accounts:${this.generationCounter}`, targets };
  }

  /**
   * Resume/fork authority: the renderer's `accountId` is only a claim. The session must be
   * rediscovered inside that account's own storage, and the authoritative copy is what launches.
   */
  public async resolveOwnedSession(input: {
    environmentId: WorkspaceEnvironmentId; harness: HarnessId; accountId: unknown; sessionId: string; workspacePath: string;
  }): Promise<{ binding: ResolvedHarnessAccountBinding; session: HarnessSession }> {
    if (typeof input.accountId !== 'string' || input.accountId === DEFAULT_HARNESS_ACCOUNT_ID) throw safeInvalid();
    const binding = this.resolveBinding({ environmentId: input.environmentId, harness: input.harness, accountId: input.accountId, forLaunch: true });
    if (binding.kind !== 'managed' || !binding.discoverSessions) throw safeInvalid();
    let sessions: HarnessSession[];
    try { sessions = await binding.discoverSessions(input.workspacePath); }
    catch { throw new HarnessAccountError('failed', 'The session history for this account could not be read.'); }
    const session = sessions.find((candidate) => candidate.harness === input.harness && candidate.id === input.sessionId);
    if (!session) throw new HarnessAccountError('not-found', 'This session was not found in its account.');
    return { binding, session };
  }

  /** Probe outcomes may only mark an account; they never delete it or reroute anything. */
  public reportStatus(accountId: HarnessAccountId, status: Exclude<HarnessAccountStatus, 'unknown'>): void {
    const record = this.state.accounts.find((candidate) => candidate.id === accountId);
    if (record) this.setStatus(record, status);
  }

  // ---------------------------------------------------------------------------------------------
  // Auth flows
  // ---------------------------------------------------------------------------------------------

  public startAdd(environmentId: unknown, harness: unknown, label?: unknown): HarnessAccountAuthStart {
    const { env, id, provider } = this.validateScope(environmentId, harness);
    if (env !== LOCAL_ENVIRONMENT_ID) throw new HarnessAccountError('unsupported', SSH_UNSUPPORTED);
    if (label !== undefined && typeof label !== 'string') throw safeInvalid();
    this.assertCanStartFlow();
    if (this.managedFor(env, id).length >= MAX_MANAGED_ACCOUNTS_PER_HARNESS) {
      throw new HarnessAccountError('busy', 'Too many accounts for this harness. Remove one first.');
    }
    const accountId = this.newAccountId();
    try {
      this.options.homes.ensure(id, accountId);
    } catch {
      throw new HarnessAccountError('failed', 'Account storage is unavailable.');
    }
    const flow = this.beginFlow({ accountId, harness: id, environmentId: env, adding: true, provider, label: sanitizeText(label, HARNESS_ACCOUNT_LABEL_MAX) });
    return { flowId: flow.id, state: flow.state };
  }

  /** Re-authenticates inside the same trusted managed home. */
  public reconnect(environmentId: unknown, harness: unknown, accountId: unknown): HarnessAccountAuthStart {
    const { env, id, provider } = this.validateScope(environmentId, harness);
    if (env !== LOCAL_ENVIRONMENT_ID) throw new HarnessAccountError('unsupported', SSH_UNSUPPORTED);
    const record = typeof accountId === 'string' ? this.findManaged(env, id, accountId) : undefined;
    if (!record) throw new HarnessAccountError('not-found', 'That account is not available for this harness.');
    this.assertCanStartFlow();
    if (this.flows.has(record.id)) throw new HarnessAccountError('busy', 'Sign-in is already in progress for this account.');
    try {
      this.options.homes.ensure(id, record.id);
    } catch {
      throw new HarnessAccountError('failed', 'Account storage is unavailable.');
    }
    const flow = this.beginFlow({ accountId: record.id, harness: id, environmentId: env, adding: false, provider });
    return { flowId: flow.id, state: flow.state };
  }

  public cancelAuth(flowId: unknown): void {
    if (typeof flowId !== 'string') throw safeInvalid();
    const flow = [...this.flows.values()].find((candidate) => candidate.id === flowId);
    if (!flow) return;
    this.abortFlow(flow, true);
  }

  private abortFlow(flow: AuthFlow, cancelled: boolean): void {
    if (cancelled) flow.cancelled = true;
    flow.controller.abort();
    const backstop = setTimeout(() => flow.hard.abort(), HARD_STOP_GRACE_MS);
    backstop.unref?.();
    void flow.done.finally(() => clearTimeout(backstop));
  }

  /** Main-owned sign-in work that window/app teardown would cancel. */
  public hasActiveSignIn(): boolean {
    return [...this.flows.values()].some(({ state }) => state.status === 'starting' || state.status === 'waiting-for-browser');
  }

  /** Cancels every active flow and waits for their processes to be reaped (shutdown, window close). */
  public async cancelAllAuth(): Promise<void> {
    const active = [...this.flows.values()];
    for (const flow of active) this.abortFlow(flow, true);
    await Promise.allSettled(active.map((flow) => flow.done));
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
    await this.cancelAllAuth();
  }

  // ---------------------------------------------------------------------------------------------
  // Removal
  // ---------------------------------------------------------------------------------------------

  /**
   * Removes one managed account: validates the record, stops its auth flow, asks the provider to sign
   * out (secure-store cleanup), drops metadata and deletes only the verified owned directory. The
   * native/default account cannot be removed and no provider-native home is ever touched. Running
   * terminals are left alone.
   */
  public async remove(environmentId: unknown, harness: unknown, accountId: unknown): Promise<HarnessAccountList> {
    const { env, id } = this.validateScope(environmentId, harness);
    if (accountId === DEFAULT_HARNESS_ACCOUNT_ID) throw new HarnessAccountError('invalid', 'The default account cannot be removed.');
    const record = typeof accountId === 'string' ? this.findManaged(env, id, accountId) : undefined;
    if (!record) throw new HarnessAccountError('not-found', 'That account is not available for this harness.');
    const active = this.flows.get(record.id);
    if (active) { this.abortFlow(active, true); await active.done.catch(() => undefined); }

    // Credentials may live in the provider's secure store rather than the managed directory, so
    // deletion is allowed only once provider-supported sign-out succeeded or proved nothing is left.
    // Anything else (no CLI, no logout support, timeout, failure, unverifiable storage) keeps the
    // account, its ID, its selection and its home exactly as they were.
    const capability = this.capabilityFor(id);
    if (!capability) throw new HarnessAccountError('unsupported', 'Accounts are not available for this harness.');
    let home: string;
    try { home = this.options.homes.ensure(id, record.id); }
    catch { throw new HarnessAccountError('failed', `${this.accountName(record)} could not be removed because its storage could not be verified.`); }
    await this.proveSignedOut(capability, home, this.accountName(record), 30_000);

    // Order matters for recoverability: delete the verified home first, then drop the record. If either
    // step fails the account identity (and selection) is kept, and a retry can prove sign-out again
    // (recreating the same trusted home if needed) and finish the cleanup.
    try {
      this.options.homes.remove(id, record.id);
    } catch {
      throw new HarnessAccountError('failed', `${this.accountName(record)} was signed out, but its storage could not be deleted. Try again.`);
    }
    this.commit((next) => {
      next.accounts = next.accounts.filter((candidate) => candidate.id !== record.id);
      for (const [key, value] of Object.entries(next.selections)) if (value === record.id) delete next.selections[key];
    });
    this.changed({ type: 'removed', accountId: record.id, harness: id });
    return this.list(env, id);
  }

  // ---------------------------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------------------------

  /** Resolves only when provider logout succeeded or the provider proved nothing is signed in. */
  private async proveSignedOut(capability: HarnessAccountsCapability, home: string, name: string, timeoutMs: number): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const execution = bindHarnessExecution(this.options.getLocalEnvironment(), capability.environment(home), controller.signal);
    try {
      await capability.logout({ executor: execution.executor, sessionExecutor: execution.sessionExecutor, signal: controller.signal, clientInfo: this.clientInfo() });
    } catch (error) {
      // Only a definitive "already signed out" proves there is nothing left to clean up.
      if (classifyHarnessFailure(error).kind !== 'unauthenticated') {
        throw new HarnessAccountError('failed', `${name} could not be signed out, so it was not removed. Try again.`);
      }
    } finally {
      clearTimeout(timer);
      await execution.disposeSessions();
    }
  }

  private beginFlow(input: {
    accountId: HarnessAccountId; harness: HarnessId; environmentId: WorkspaceEnvironmentId; adding: boolean;
    provider: HarnessProvider; label?: string;
  }): AuthFlow {
    const controller = new AbortController();
    const flow: AuthFlow = {
      id: `flow_${randomBytes(12).toString('hex')}`, accountId: input.accountId, harness: input.harness, environmentId: input.environmentId,
      adding: input.adding, controller, hard: new AbortController(), cancelled: false, timedOut: false, state: { status: 'starting' }, done: Promise.resolve(),
    };
    this.flows.set(flow.accountId, flow);
    flow.done = this.runFlow(flow, input.provider.accounts!, input.provider.descriptor.name, input.label);
    return flow;
  }

  private async runFlow(flow: AuthFlow, capability: HarnessAccountsCapability, harnessName: string, label?: string): Promise<void> {
    const timer = setTimeout(() => { flow.timedOut = true; this.abortFlow(flow, false); }, this.authTimeoutMs);
    let execution: ReturnType<typeof bindHarnessExecution> | undefined;
    let retainedHome = false;
    try {
      const home = this.options.homes.resolve(flow.harness, flow.accountId);
      execution = bindHarnessExecution(this.options.getLocalEnvironment(), capability.environment(home), flow.hard.signal);
      const identity = await capability.authenticate({
        executor: execution.executor, sessionExecutor: execution.sessionExecutor, signal: flow.controller.signal, clientInfo: this.clientInfo(),
        openUrl: (url) => this.openAuthUrl(flow, url),
        waitingForBrowser: () => this.setFlowState(flow, { status: 'waiting-for-browser' }),
      });
      // Winner rule, with no await between this check and the commit: a flow that was cancelled, timed
      // out, shut down or scope-cancelled before `authenticate` returned never commits, whether or not
      // the provider honoured the abort. Once past this line success owns the result and a later
      // cancel is moot. (An add that loses here is rolled back below with proven credential cleanup.)
      if (flow.controller.signal.aborted || flow.cancelled || flow.timedOut || this.disposed) {
        throw new HarnessCapabilityError('aborted', 'Sign-in was cancelled');
      }
      const record = this.commitAccount(flow, identity, label);
      this.setFlowState(flow, { status: 'connected', account: this.project(record, this.selectedId(flow.environmentId, flow.harness)) });
    } catch (error) {
      if (flow.adding) retainedHome = !(await this.discardAddedHome(flow, capability, error));
      if (error instanceof HarnessAccountError) this.setFlowState(flow, { status: 'failed', message: error.message });
      else if (flow.cancelled || this.disposed) this.setFlowState(flow, { status: 'cancelled' });
      else this.setFlowState(flow, { status: 'failed', message: this.safeAuthMessage(error, harnessName, flow.timedOut) });
    } finally {
      clearTimeout(timer);
      await execution?.disposeSessions();
      flow.hard.abort();
      if (this.flows.get(flow.accountId) === flow) this.flows.delete(flow.accountId);
      // A home we could not prove clean is kept and surfaced as a reconnectable account.
      if (retainedHome) this.recoverOrphanedHomes();
    }
  }

  /**
   * Rolls back a failed or abandoned add. Credentials may already sit in the provider's secure store,
   * so the owned home is deleted only after provider sign-out succeeded or proved nothing is signed in
   * (skipped only when the provider CLI never ran). Returns whether the home was deleted.
   */
  private async discardAddedHome(flow: AuthFlow, capability: HarnessAccountsCapability, error: unknown): Promise<boolean> {
    const neverRan = error instanceof HarnessCapabilityError && error.kind === 'binary-unavailable';
    try {
      if (!neverRan) {
        const home = this.options.homes.resolve(flow.harness, flow.accountId);
        await this.proveSignedOut(capability, home, 'This account', ADD_CLEANUP_TIMEOUT_MS);
      }
      this.options.homes.remove(flow.harness, flow.accountId);
      return true;
    } catch {
      return false; // unproven cleanup or unsafe storage: keep the home recoverable
    }
  }

  private commitAccount(flow: AuthFlow, identity: HarnessAccountIdentity, label?: string): StoredHarnessAccount {
    const email = sanitizeText(identity?.email);
    const plan = sanitizeText(identity?.plan, 40);
    if (flow.adding) {
      const record: StoredHarnessAccount = {
        id: flow.accountId, harness: flow.harness, environmentId: flow.environmentId, kind: 'managed',
        ...(label ? { label } : {}), createdAt: this.now(), ...(email ? { email } : {}), ...(plan ? { plan } : {}), status: 'connected',
      };
      this.commit((next) => { next.accounts.push(record); });
      this.changed({ type: 'added', accountId: record.id, harness: record.harness });
      return record;
    }
    if (!this.findManaged(flow.environmentId, flow.harness, flow.accountId)) throw new HarnessCapabilityError('aborted', 'The account was removed');
    this.commit((next) => {
      const target = next.accounts.find((candidate) => candidate.id === flow.accountId)!;
      if (email) target.email = email; else delete target.email;
      if (plan) target.plan = plan; else delete target.plan;
      target.status = 'connected';
    });
    this.changed({ type: 'reconnected', accountId: flow.accountId, harness: flow.harness });
    return this.findManaged(flow.environmentId, flow.harness, flow.accountId)!;
  }

  private openAuthUrl(flow: AuthFlow, rawUrl: string): void {
    const safe = typeof rawUrl === 'string' ? normalizeExternalUrl(rawUrl) : null;
    if (!safe || !/^https?:\/\//i.test(safe)) throw new HarnessCapabilityError('command-failed', 'Provider returned an unusable sign-in address');
    if (flow.controller.signal.aborted) return;
    this.options.openExternal(safe);
  }

  private setFlowState(flow: AuthFlow, state: AccountAuthState): void {
    // A finished flow never reports progress again.
    if (flow.state.status === 'connected' || flow.state.status === 'failed' || flow.state.status === 'cancelled') return;
    flow.state = state;
    this.options.onAuthState?.({ flowId: flow.id, environmentId: flow.environmentId, harness: flow.harness, state });
  }

  /** Raw provider errors can carry tokens, URLs or paths, so only fixed text is produced here. */
  private safeAuthMessage(error: unknown, harnessName: string, timedOut: boolean): string {
    if (timedOut) return 'Sign-in timed out. Try again.';
    if (error instanceof UnsafeAccountPathError) return 'Account storage is unavailable.';
    switch (classifyHarnessFailure(error).kind) {
      case 'binary-unavailable': return `${harnessName} is not installed on this machine.`;
      case 'timeout': return 'Sign-in timed out. Try again.';
      case 'unauthenticated': return 'Sign-in was not completed.';
      case 'unsupported': return `${harnessName} accounts are not supported by the installed version.`;
      default: return 'Sign-in failed. Try again.';
    }
  }

  private assertCanStartFlow(): void {
    if (this.disposed) throw new HarnessAccountError('failed', 'Accounts are shutting down.');
    if (this.flows.size >= MAX_ACTIVE_AUTH_FLOWS) throw new HarnessAccountError('busy', 'Too many sign-ins in progress.');
  }

  private clientInfo() {
    return { name: 'clanker-grid', title: 'Clanker Grid', version: this.options.clientVersion?.() ?? 'unknown' } as const;
  }

  private validateScope(environmentId: unknown, harness: unknown): { env: WorkspaceEnvironmentId; id: HarnessId; provider: HarnessProvider } {
    if (typeof environmentId !== 'string' || !environmentId || environmentId.length > 256 || environmentId.includes('\0')) throw safeInvalid();
    const provider = this.findProvider(harness);
    if (!provider?.accounts) throw new HarnessAccountError('unsupported', 'Accounts are not available for this harness.');
    return { env: environmentId, id: provider.descriptor.id, provider };
  }

  private capabilityFor(harness: HarnessId): HarnessAccountsCapability | undefined {
    return this.findProvider(harness)?.accounts;
  }

  private newAccountId(): string {
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = `acct_${(this.options.randomId ?? (() => randomBytes(16).toString('hex')))()}`;
      if (MANAGED_ACCOUNT_ID_PATTERN.test(id) && !this.state.accounts.some((record) => record.id === id) && ![...this.flows.keys()].includes(id)) return id;
    }
    throw new HarnessAccountError('failed', 'Could not allocate an account.');
  }

  private managedFor(environmentId: string, harness: string): StoredHarnessAccount[] {
    return this.state.accounts.filter((record) => record.environmentId === environmentId && record.harness === harness);
  }

  private findManaged(environmentId: string, harness: string, accountId: string): StoredHarnessAccount | undefined {
    return this.state.accounts.find((record) => record.id === accountId && record.environmentId === environmentId && record.harness === harness);
  }

  /** A selection pointing at a removed or foreign account silently means the native/default account. */
  private selectedId(environmentId: string, harness: string): HarnessAccountId {
    const chosen = this.state.selections[selectionKey(environmentId, harness)];
    return chosen && this.findManaged(environmentId, harness, chosen) ? chosen : DEFAULT_HARNESS_ACCOUNT_ID;
  }

  private defaultRecord(harness: HarnessId): StoredHarnessAccount | { id: 'default'; harness: HarnessId; kind: 'default' } {
    return { id: DEFAULT_HARNESS_ACCOUNT_ID as 'default', harness, kind: 'default' };
  }

  private project(record: StoredHarnessAccount | { id: 'default'; harness: HarnessId; kind: 'default' }, selectedId: HarnessAccountId): SafeHarnessAccount {
    if (record.kind === 'default') {
      return { id: DEFAULT_HARNESS_ACCOUNT_ID, harness: record.harness, kind: 'default', status: 'unknown', selected: selectedId === DEFAULT_HARNESS_ACCOUNT_ID };
    }
    return {
      id: record.id, harness: record.harness, kind: 'managed', status: record.status ?? 'unknown', selected: selectedId === record.id,
      ...(record.label ? { label: record.label } : {}), ...(record.email ? { email: record.email } : {}), ...(record.plan ? { plan: record.plan } : {}),
    };
  }

  private accountName(record: StoredHarnessAccount): string {
    return record.label ?? record.email ?? 'This account';
  }

  /** Background marking never throws: if it cannot be saved, the committed status simply stays. */
  private setStatus(record: StoredHarnessAccount, status: HarnessAccountStatus): void {
    if (record.status === status) return;
    try {
      this.commit((next) => { const target = next.accounts.find((candidate) => candidate.id === record.id); if (target) target.status = status; });
    } catch { /* conservative: previous status remains; no storage detail escapes */ }
  }

  private changed(change: HarnessAccountChange): void {
    this.generationCounter++;
    for (const listener of [...this.listeners]) {
      try { listener(change); } catch { /* a listener cannot break account operations */ }
    }
  }

  /**
   * The only way registry state changes: build the next state from a copy, persist it, and publish it
   * in memory only after the save succeeded. A failed save leaves the previous state untouched and is
   * reported as a fixed message (raw storage errors can carry paths and never cross this boundary).
   */
  private commit(mutate: (next: HarnessAccountRegistryState) => void): void {
    const next: HarnessAccountRegistryState = { accounts: this.state.accounts.map((record) => ({ ...record })), selections: { ...this.state.selections } };
    mutate(next);
    try {
      this.options.storage.save(next);
    } catch {
      throw new HarnessAccountError('failed', 'Account settings could not be saved. Try again.');
    }
    this.state = next;
  }

  /**
   * Homes that exist under the owned root with no registry entry (a verified sign-in whose record could
   * not be saved and whose cleanup could not be proven, or a crash after sign-in) become `needs-auth`
   * records, so the user can reconnect or remove them instead of the credentials being orphaned. Only
   * validated owned homes with content are recovered, and none is ever treated as authenticated.
   */
  public recoverOrphanedHomes(): void {
    const recovered: StoredHarnessAccount[] = [];
    for (const home of this.options.homes.listOwnedHomes()) {
      if (home.empty || this.flows.has(home.id) || this.state.accounts.some((record) => record.id === home.id)) continue;
      const provider = this.findProvider(home.harness);
      if (!provider?.accounts) continue;
      recovered.push({ id: home.id, harness: provider.descriptor.id, environmentId: LOCAL_ENVIRONMENT_ID, kind: 'managed', createdAt: this.now(), status: 'needs-auth' });
    }
    if (recovered.length === 0) return;
    try { this.commit((next) => { next.accounts.push(...recovered); }); } catch { return; }
    for (const record of recovered) this.changed({ type: 'added', accountId: record.id, harness: record.harness });
  }

  /** Tolerant load: anything malformed or foreign is dropped rather than trusted. */
  private loadState(): HarnessAccountRegistryState {
    let raw: unknown;
    try { raw = this.options.storage.load(); } catch { raw = undefined; }
    const rawObject = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const accounts: StoredHarnessAccount[] = [];
    const seen = new Set<string>();
    for (const entry of Array.isArray(rawObject.accounts) ? rawObject.accounts : []) {
      if (!entry || typeof entry !== 'object') continue;
      const value = entry as Record<string, unknown>;
      const provider = this.findProvider(value.harness);
      if (!provider?.accounts || typeof value.id !== 'string' || !MANAGED_ACCOUNT_ID_PATTERN.test(value.id) || seen.has(value.id)) continue;
      // Managed accounts are local-only in v1: a record scoped to any other environment is not trusted.
      if (value.environmentId !== LOCAL_ENVIRONMENT_ID || value.kind !== 'managed') continue;
      seen.add(value.id);
      const label = sanitizeText(value.label, HARNESS_ACCOUNT_LABEL_MAX);
      const email = sanitizeText(value.email);
      const plan = sanitizeText(value.plan, 40);
      accounts.push({
        id: value.id, harness: provider.descriptor.id, environmentId: value.environmentId, kind: 'managed',
        createdAt: typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? value.createdAt : 0,
        ...(label ? { label } : {}), ...(email ? { email } : {}), ...(plan ? { plan } : {}),
        ...(STATUSES.includes(value.status as HarnessAccountStatus) ? { status: value.status as HarnessAccountStatus } : {}),
      });
    }
    const selections: Record<string, HarnessAccountId> = {};
    const rawSelections = rawObject.selections && typeof rawObject.selections === 'object' ? rawObject.selections as Record<string, unknown> : {};
    for (const [key, value] of Object.entries(rawSelections)) {
      if (typeof value === 'string' && accounts.some((record) => record.id === value && selectionKey(record.environmentId, record.harness) === key)) selections[key] = value;
    }
    return { accounts, selections };
  }
}

function unusableBinding(environmentId: WorkspaceEnvironmentId, harness: HarnessId, safe: SafeHarnessAccount): ResolvedHarnessAccountBinding {
  return {
    id: safe.id, kind: 'managed', harness, environmentId, environment: Object.freeze({}), safe: { ...safe, status: 'needs-auth' },
    unusable: true, mergeEnvironment: () => { throw new HarnessAccountError('needs-auth', 'This account cannot be used until it is reconnected.'); },
  };
}

function defaultBinding(environmentId: WorkspaceEnvironmentId, harness: HarnessId, selected: boolean): ResolvedHarnessAccountBinding {
  return {
    id: DEFAULT_HARNESS_ACCOUNT_ID, kind: 'default', harness, environmentId, environment: Object.freeze({}),
    safe: { id: DEFAULT_HARNESS_ACCOUNT_ID, harness, kind: 'default', status: 'unknown', selected },
    mergeEnvironment: (base) => base as never,
  };
}

/**
 * The one trusted seam for account-bound execution. Without a service (or for a harness that has no
 * account capability) the result is the default binding, whose environment contribution is empty, so
 * default launches stay exactly what they were.
 */
export function prepareHarnessAccountContext(
  service: HarnessAccountService | undefined,
  input: { environmentId: WorkspaceEnvironmentId; harness: string; accountId?: HarnessAccountId; forLaunch?: boolean },
): ResolvedHarnessAccountBinding {
  const provider = findHarnessProvider(input.harness);
  if (!service || !provider?.accounts) {
    return defaultBinding(input.environmentId, (provider?.descriptor.id ?? input.harness) as HarnessId, true);
  }
  return service.resolveBinding({ forLaunch: true, ...input, harness: provider.descriptor.id });
}
