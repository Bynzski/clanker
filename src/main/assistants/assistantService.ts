import { randomUUID } from 'node:crypto';
import type { AssistantLaunchRequest, AssistantLaunchResult, AssistantProfile, AssistantSettings, AssistantSnapshot } from '../../shared/types/assistants';
import type { HarnessCommandExecutor } from '../harnesses/commandExecution';
import type { HarnessNativeProfile, HarnessProfilesCapability } from '../harnesses/types';
import type { WorkspaceLocation } from '../../shared/types/environments';
import { pathKey } from '../../shared/pathKey';
import { validateAssistantSettings } from './assistantSettings';
import { isValidHarnessProfileName } from '../../shared/harnessProfiles';
import { toNativePath } from '../../shared/pathNormalize';

const MAX_ASSISTANT_PROFILES = 64;

interface AssistantServiceDeps {
  readSettings(): AssistantSettings | undefined;
  writeSettings(settings: AssistantSettings): void;
  getProfilesCapability(harnessId: string): HarnessProfilesCapability | undefined;
  profileHarnessIds: readonly string[];
  executor(harnessId: string): HarnessCommandExecutor;
  getWorkspace(id: string): { workspaceId: string; location: WorkspaceLocation } | null;
  spawn(workspaceId: string, harnessId: string, launch: ReturnType<HarnessProfilesCapability['buildLaunch']>): Promise<{ id: string; pid: number; attentionEnabled?: boolean; checkoutContextId?: string }>;
  killTerminal(terminalId: string): void;
  onChanged(snapshot: AssistantSnapshot): void;
  isShuttingDown(): boolean;
}

/** Main-owned presentation and launch ownership; native state remains with the provider. */
export class AssistantService {
  private readonly profiles = new Map<string, { public: AssistantProfile; native: HarnessNativeProfile }>();
  private readonly launches = new Map<string, AssistantLaunchResult>();
  private readonly pending = new Map<string, Promise<AssistantLaunchResult>>();
  private readonly pendingHomes = new Map<string, Promise<AssistantLaunchResult>>();
  private readonly launchHomes = new Map<string, string>();
  private epoch = 0;
  private readonly earlyExits = new Set<string>();
  private discoveryError: string | undefined;
  private profilesChecked = false;
  private discoveryRevision = 0;
  private discoveryOperation: Promise<AssistantSnapshot> | undefined;
  constructor(private readonly deps: AssistantServiceDeps) {}

  get(): AssistantSnapshot {
    let settings: AssistantSettings;
    try { settings = validateAssistantSettings(this.deps.readSettings() ?? { enabled: false, pins: [] }); }
    catch { settings = { enabled: false, pins: [] }; }
    return { settings, profiles: [...this.profiles.values()].map((entry) => ({ ...entry.public })), launches: [...this.launches.values()].map(({ profileId, workspaceId, terminalId }) => ({ profileId, workspaceId, terminalId, state: 'open' })), externalActivity: 'unknown', profilesChecked: this.profilesChecked, ...(this.discoveryError ? { discoveryError: this.discoveryError } : {}) };
  }

  configure(value: unknown): AssistantSnapshot {
    const settings = validateAssistantSettings(value);
    if (settings.pins.some((pin) => !this.deps.getProfilesCapability(pin.harnessId))) throw new Error('Invalid assistant pin: profiles capability is unavailable');
    // Disabling invalidates in-flight discovery; a later request must never coalesce onto it.
    if (this.get().settings.enabled && !settings.enabled) { this.epoch++; this.discoveryOperation = undefined; }
    this.deps.writeSettings(structuredClone(settings));
    const snapshot = this.get();
    this.deps.onChanged(snapshot);
    return snapshot;
  }

  /** `ifUnchecked` is the cold-start hydration path: it never re-probes once this process has checked. */
  async discover(options?: { ifUnchecked?: boolean }): Promise<AssistantSnapshot> {
    if (!this.get().settings.enabled) throw new Error('Assistants integration is disabled');
    if (options?.ifUnchecked && this.profilesChecked && !this.discoveryOperation) return this.get();
    if (this.discoveryOperation) return this.discoveryOperation;
    const revision = ++this.discoveryRevision;
    const epoch = this.epoch;
    const operation = this.collectProfiles(revision, epoch);
    this.discoveryOperation = operation;
    try { return await operation; }
    finally { if (this.discoveryOperation === operation) this.discoveryOperation = undefined; }
  }

  private async collectProfiles(revision: number, epoch: number): Promise<AssistantSnapshot> {
    const found = new Map<string, { harnessId: string; native: HarnessNativeProfile }>();
    const errors = new Set<string>();
    let overflow = false;
    for (const harnessId of this.deps.profileHarnessIds) {
      const capability = this.deps.getProfilesCapability(harnessId);
      if (!capability) continue;
      try {
        const profiles = await capability.discover(this.deps.executor(harnessId));
        // Overflow is not an ordinary failure: nothing is copied (bounded memory) and the roster stays untouched.
        if (profiles.length > MAX_ASSISTANT_PROFILES) overflow = true;
        else for (const native of profiles) found.set(`${harnessId}:${native.name}`, { harnessId, native });
      } catch {
        errors.add('Automatic profile discovery unavailable. Select an existing profile by name; only local terminal backends are supported.');
      }
      for (const pin of this.get().settings.pins.filter((pin) => pin.harnessId === harnessId)) {
        const key = `${harnessId}:${pin.profileName}`;
        if (found.has(key)) continue;
        try { found.set(key, { harnessId, native: await capability.resolve(this.deps.executor(harnessId), pin.profileName) }); }
        catch { errors.add('One or more pinned profiles are unavailable. Refresh or remove the missing pin.'); }
      }
    }
    if (epoch !== this.epoch || revision !== this.discoveryRevision || !this.get().settings.enabled || this.deps.isShuttingDown()) return this.get();
    // Atomic with respect to the roster: the final roster is every found identity plus owned launches
    // that survive even when absent from this discovery. Overflow changes nothing but the status.
    const finalIdentities = new Set(found.keys());
    for (const [id, profile] of this.profiles) if (this.launches.has(id)) finalIdentities.add(`${profile.public.harnessId}:${profile.native.name}`);
    if (overflow || finalIdentities.size > MAX_ASSISTANT_PROFILES) {
      errors.add(`Too many Assistant profiles (limit ${MAX_ASSISTANT_PROFILES}); the previous profile list was kept. Remove pins or profiles, then refresh.`);
      this.discoveryError = [...errors].join(' ');
      this.profilesChecked = true;
      const snapshot = this.get();
      this.deps.onChanged(snapshot);
      return snapshot;
    }
    for (const { harnessId, native } of found.values()) this.addResolved(harnessId, native);
    for (const [id, profile] of this.profiles) {
      if (!found.has(`${profile.public.harnessId}:${profile.native.name}`) && !this.launches.has(id)) this.profiles.delete(id);
    }
    this.discoveryError = [...errors].join(' ') || undefined;
    this.profilesChecked = true;
    const snapshot = this.get();
    this.deps.onChanged(snapshot);
    return snapshot;
  }

  private addResolved(harnessId: string, profile: HarnessNativeProfile): void {
    const previous = [...this.profiles.values()].find((entry) => entry.public.harnessId === harnessId && entry.public.profileName === profile.name);
    const id = previous?.public.id ?? randomUUID();
    if (!previous && this.profiles.size >= MAX_ASSISTANT_PROFILES) throw new Error('Assistant profile limit reached; refresh profiles');
    this.profiles.set(id, { public: { id, harnessId, profileName: profile.name, label: profile.label }, native: profile });
  }

  async addProfile(harnessId: string, profileName: string): Promise<AssistantSnapshot> {
    if (!this.get().settings.enabled) throw new Error('Assistants integration is disabled');
    if (typeof harnessId !== 'string' || !isValidHarnessProfileName(profileName)) throw new Error('Invalid assistant profile reference');
    const capability = this.deps.getProfilesCapability(harnessId);
    if (!capability) throw new Error('Profiles capability is unavailable');
    const epoch = this.epoch;
    const native = await capability.resolve(this.deps.executor(harnessId), profileName);
    if (epoch !== this.epoch || this.deps.isShuttingDown()) throw new Error('Assistant application state changed');
    if (!this.get().settings.enabled) throw new Error('Assistants integration is disabled');
    this.discoveryRevision++;
    this.addResolved(harnessId, native);
    const snapshot = this.get();
    this.deps.onChanged(snapshot);
    return snapshot;
  }

  async launch(request: AssistantLaunchRequest): Promise<AssistantLaunchResult> {
    if (!this.get().settings.enabled) throw new Error('Assistants integration is disabled');
    // Ownership model: the caller is the registered workspace identity that initiated THIS request.
    // It is captured once and rechecked after every await, independently of the workspace that owns
    // an already-created or in-flight terminal. A stale caller only ever rejects itself: only the
    // operation that created a PTY may kill it.
    const epoch = this.epoch;
    const workspace = this.deps.getWorkspace(request.workspaceId);
    if (!workspace || workspace.location.environmentId !== 'local') throw new Error('Assistant launch requires a registered local workspace');
    const location = { ...workspace.location };
    const assertCaller = () => {
      const current = this.deps.getWorkspace(workspace.workspaceId);
      if (this.epoch !== epoch || !this.get().settings.enabled || this.deps.isShuttingDown()) throw new Error('Assistant launch was disabled or application state changed');
      if (!current || current !== workspace || current.location.path !== location.path || current.location.environmentId !== location.environmentId) throw new Error('Registered assistant workspace changed');
    };
    const existing = this.launches.get(request.profileId);
    if (existing) return { ...existing, action: 'focus' };
    const pending = this.pending.get(request.profileId);
    if (pending) {
      const shared = await pending;
      assertCaller();
      return { ...shared, action: 'focus' };
    }
    const profile = this.profiles.get(request.profileId);
    if (!profile) throw new Error('Assistant profile is unavailable; refresh profiles');
    if (!request.acknowledgeExternalActivity) throw new Error('External profile activity must be acknowledged');
    const capability = this.deps.getProfilesCapability(profile.public.harnessId);
    if (!capability) throw new Error('Profiles capability is unavailable');
    let reservedHome: string | undefined;
    const operation = (async (): Promise<AssistantLaunchResult> => {
      const native = await capability.resolve(this.deps.executor(profile.public.harnessId), profile.native.name);
      assertCaller();
      const homeKey = `${profile.public.harnessId}:${pathKey(native.home, process.platform === 'win32')}`;
      const caseFold = process.platform === 'win32';
      if (native.name !== profile.native.name || pathKey(native.home, caseFold) !== pathKey(profile.native.home, caseFold)) throw new Error('Assistant profile home changed; refresh profiles');
      // The native root is part of profile identity: the same canonical home under a different
      // root is a different native installation. A missing root on either side cannot be verified.
      if (!native.rootHome || !profile.native.rootHome || pathKey(native.rootHome, caseFold) !== pathKey(profile.native.rootHome, caseFold)) throw new Error('Assistant profile root changed; refresh profiles');
      const ownerId = [...this.launchHomes].find(([, home]) => home === homeKey)?.[0];
      const owned = ownerId && this.launches.get(ownerId);
      if (owned) return { ...owned, action: 'focus' };
      const sameHomePending = this.pendingHomes.get(homeKey);
      if (sameHomePending) {
        const shared = await sameHomePending;
        assertCaller();
        return { ...shared, action: 'focus' };
      }
      reservedHome = homeKey;
      this.pendingHomes.set(homeKey, this.pending.get(profile.public.id)!);
      const spawned = await this.deps.spawn(workspace.workspaceId, profile.public.harnessId, capability.buildLaunch(native, toNativePath(location.path, process.platform)));
      try {
        assertCaller();
        if (this.earlyExits.delete(spawned.id)) throw new Error('Assistant terminal exited during startup');
      } catch (error) {
        this.deps.killTerminal(spawned.id);
        throw error;
      }
      const result: AssistantLaunchResult = { action: 'created', workspaceId: workspace.workspaceId, terminalId: spawned.id, pid: spawned.pid, harnessId: profile.public.harnessId, profileId: profile.public.id, profileName: profile.public.profileName, attentionEnabled: spawned.attentionEnabled ?? false, ...(spawned.checkoutContextId ? { checkoutContextId: spawned.checkoutContextId } : {}) };
      this.launches.set(profile.public.id, result);
      this.launchHomes.set(profile.public.id, homeKey);
      this.deps.onChanged(this.get());
      return result;
    })();
    this.pending.set(profile.public.id, operation);
    try {
      return await operation;
    } finally {
      this.pending.delete(profile.public.id);
      if (reservedHome && this.pendingHomes.get(reservedHome) === operation) this.pendingHomes.delete(reservedHome);
      if (this.pending.size === 0) this.earlyExits.clear();
    }
  }

  closeWorkspace(workspaceId: string): void {
    for (const launch of [...this.launches.values()]) {
      if (launch.workspaceId !== workspaceId) continue;
      this.deps.killTerminal(launch.terminalId);
      this.releaseTerminal(launch.terminalId);
    }
  }

  /** Window teardown invalidates pending probes and launches without changing opt-in preferences. */
  reset(): void {
    this.epoch++;
    this.discoveryRevision++;
    this.discoveryOperation = undefined;
    for (const launch of [...this.launches.values()]) this.deps.killTerminal(launch.terminalId);
    this.launches.clear();
    this.launchHomes.clear();
    this.profiles.clear();
    this.discoveryError = undefined;
    this.profilesChecked = false;
  }

  releaseTerminal(terminalId: string): void {
    let changed = false;
    for (const [id, launch] of this.launches) {
      if (launch.terminalId !== terminalId) continue;
      this.launches.delete(id);
      this.launchHomes.delete(id);
      changed = true;
    }
    if (this.pending.size > 0 && !changed) {
      this.earlyExits.add(terminalId);
      // Only relevant during pending launches; bound unrelated terminal-exit bookkeeping.
      if (this.earlyExits.size > 512) this.earlyExits.delete(this.earlyExits.values().next().value!);
    }
    if (changed) this.deps.onChanged(this.get());
  }
}
