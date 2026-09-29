import type Store from 'electron-store';
import type { StoreSchema } from '../shared/types/store';
import type {
  WorkspaceRecipe,
  RecipeLaunchStep,
  PersistedRecipeLayout,
} from '../shared/types/recipes';
import type {
  TaskSessionRecord,
  TaskRecoveryState,
} from '../shared/types/taskSessions';
import {
  normalizeWorkspacePath,
  isSameWorkspaceIdentity,
  parseWorkspaceIdentity,
} from '../shared/workspaceIdentity';
import { LOCAL_ENVIRONMENT_ID, type SshEnvironmentConfig } from '../shared/types/environments';
import { isValidWorkspaceEnvironmentId, validateSshEnvironmentConfig } from '../shared/sshValidation';
import { normalizeTrustedAppBrowserUrl } from './security';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function sanitizeRecipeLaunchStep(step: unknown): RecipeLaunchStep | null {
  if (!isObject(step) || !isNonEmptyString(step.id)) return null;

  if (step.type === 'shell') {
    return {
      id: step.id.trim(),
      type: 'shell',
      ...(isNonEmptyString(step.title) ? { title: step.title.trim() } : {}),
    };
  }

  if (step.type === 'command') {
    if (!isNonEmptyString(step.command)) return null;
    return {
      id: step.id.trim(),
      type: 'command',
      command: step.command.trim(),
      ...(isNonEmptyString(step.title) ? { title: step.title.trim() } : {}),
    };
  }

  if (step.type === 'harness') {
    if (!isNonEmptyString(step.harnessId)) return null;
    return {
      id: step.id.trim(),
      type: 'harness',
      harnessId: step.harnessId.trim(),
      ...(isNonEmptyString(step.modelId) ? { modelId: step.modelId.trim() } : {}),
      ...(isNonEmptyString(step.title) ? { title: step.title.trim() } : {}),
    };
  }

  return null;
}

export function sanitizeWorkspaceRecipe(input: unknown): WorkspaceRecipe | null {
  if (!isObject(input)) return null;
  if (!isNonEmptyString(input.id) || !isNonEmptyString(input.name) || !isNonEmptyString(input.workspacePath)) {
    return null;
  }
  if (input.environmentId != null && input.environmentId !== ''
    && !isValidWorkspaceEnvironmentId(input.environmentId)) return null;

  const normalizedPath = normalizeWorkspacePath(input.workspacePath);
  if (!normalizedPath) return null;

  const rawLaunches = Array.isArray(input.launches) ? input.launches : [];
  const launches: RecipeLaunchStep[] = [];
  for (const rawStep of rawLaunches) {
    const sanitized = sanitizeRecipeLaunchStep(rawStep);
    if (sanitized) launches.push(sanitized);
  }

  let browser: { url: string } | undefined;
  if (isObject(input.browser) && typeof input.browser.url === 'string') {
    const safeUrl = normalizeTrustedAppBrowserUrl(input.browser.url);
    if (safeUrl) {
      browser = { url: safeUrl };
    }
  }

  let layout: PersistedRecipeLayout | undefined;
  if (isObject(input.layout) && isFiniteNumber(input.layout.terminalCount)) {
    layout = {
      root: input.layout.root ?? null,
      terminalCount: Math.max(1, Math.floor(input.layout.terminalCount)),
      ...(typeof input.layout.explorerVisible === 'boolean'
        ? { explorerVisible: input.layout.explorerVisible }
        : {}),
    };
  }

  const now = Date.now();
  const createdAt = isFiniteNumber(input.createdAt) ? input.createdAt : now;
  const updatedAt = isFiniteNumber(input.updatedAt) ? input.updatedAt : now;

  const environmentId = isNonEmptyString(input.environmentId)
    ? input.environmentId.trim()
    : LOCAL_ENVIRONMENT_ID;

  return {
    id: input.id.trim(),
    name: input.name.trim(),
    workspacePath: normalizedPath,
    environmentId,
    ...(isNonEmptyString(input.description) ? { description: input.description.trim() } : {}),
    ...(isFiniteNumber(input.terminalCount) ? { terminalCount: Math.max(1, Math.floor(input.terminalCount)) } : {}),
    launches,
    ...(browser ? { browser } : {}),
    ...(layout ? { layout } : {}),
    createdAt,
    updatedAt,
    version: 1,
  };
}

const VALID_TASK_STATES: Record<TaskRecoveryState, true> = {
  running: true,
  resumable: true,
  'needs-selection': true,
  unavailable: true,
};

export function sanitizeTaskSessionRecord(input: unknown): TaskSessionRecord | null {
  if (!isObject(input)) return null;
  if (!isNonEmptyString(input.id) || !isNonEmptyString(input.workspacePath) || !isNonEmptyString(input.harnessId)) {
    return null;
  }
  if (input.environmentId != null && input.environmentId !== ''
    && !isValidWorkspaceEnvironmentId(input.environmentId)) return null;

  const normalizedPath = normalizeWorkspacePath(input.workspacePath);
  if (!normalizedPath) return null;

  const rawState = typeof input.state === 'string' ? input.state : 'unavailable';
  const state: TaskRecoveryState = rawState in VALID_TASK_STATES
    ? (rawState as TaskRecoveryState)
    : 'unavailable';

  const now = Date.now();
  const createdAt = isFiniteNumber(input.createdAt) ? input.createdAt : now;
  const updatedAt = isFiniteNumber(input.updatedAt) ? input.updatedAt : now;

  const environmentId = isNonEmptyString(input.environmentId)
    ? input.environmentId.trim()
    : LOCAL_ENVIRONMENT_ID;

  return {
    id: input.id.trim(),
    workspacePath: normalizedPath,
    environmentId,
    harnessId: input.harnessId.trim(),
    title: isNonEmptyString(input.title) ? input.title.trim() : `${input.harnessId.trim()} Task`,
    ...(isNonEmptyString(input.modelId) ? { modelId: input.modelId.trim() } : {}),
    ...(isNonEmptyString(input.terminalId) ? { terminalId: input.terminalId.trim() } : {}),
    ...(isNonEmptyString(input.nativeSessionId) ? { nativeSessionId: input.nativeSessionId.trim() } : {}),
    ...(isNonEmptyString(input.nativeSessionPath) ? { nativeSessionPath: input.nativeSessionPath.trim() } : {}),
    state,
    ...(isNonEmptyString(input.stateReason) ? { stateReason: input.stateReason.trim() } : {}),
    createdAt,
    updatedAt,
    ...(isFiniteNumber(input.stoppedAt) ? { stoppedAt: input.stoppedAt } : {}),
    version: 1,
  };
}

export class WorkspacePersistenceService {
  constructor(private readonly getStore: () => Store<StoreSchema>) {}

  public getAllRecipes(): WorkspaceRecipe[] {
    try {
      const raw = this.getStore().get('workspaceRecipes');
      if (!Array.isArray(raw)) return [];
      const sanitized: WorkspaceRecipe[] = [];
      for (const item of raw) {
        const recipe = sanitizeWorkspaceRecipe(item);
        if (recipe) sanitized.push(recipe);
      }
      return sanitized;
    } catch {
      return [];
    }
  }

  public getRecipesForWorkspace(workspacePath: string, environmentId?: string): WorkspaceRecipe[] {
    const all = this.getAllRecipes();
    const parsed = parseWorkspaceIdentity(workspacePath);
    const target = {
      environmentId: environmentId || parsed.environmentId,
      path: parsed.path,
    };
    return all.filter((recipe) => isSameWorkspaceIdentity(
      { environmentId: recipe.environmentId || LOCAL_ENVIRONMENT_ID, path: recipe.workspacePath },
      target
    ));
  }

  public getRecipeById(recipeId: string): WorkspaceRecipe | null {
    if (!recipeId) return null;
    const all = this.getAllRecipes();
    return all.find((r) => r.id === recipeId) ?? null;
  }

  public saveRecipe(recipeInput: unknown): WorkspaceRecipe {
    const sanitized = sanitizeWorkspaceRecipe(recipeInput);
    if (!sanitized) {
      throw new Error('Invalid workspace recipe payload');
    }
    if (sanitized.environmentId !== LOCAL_ENVIRONMENT_ID) {
      throw new Error('Launch recipes are not supported for SSH workspaces in this version.');
    }

    const all = this.getAllRecipes();
    const existingIndex = all.findIndex((r) => r.id === sanitized.id);
    const updated = {
      ...sanitized,
      updatedAt: Date.now(),
    };

    let nextList: WorkspaceRecipe[];
    if (existingIndex >= 0) {
      nextList = [...all];
      nextList[existingIndex] = updated;
    } else {
      nextList = [...all, updated];
    }

    this.getStore().set('workspaceRecipes', nextList);
    return updated;
  }

  public deleteRecipe(recipeId: string): boolean {
    if (!recipeId) return false;
    const all = this.getAllRecipes();
    const filtered = all.filter((r) => r.id !== recipeId);
    if (filtered.length === all.length) return false;

    this.getStore().set('workspaceRecipes', filtered);
    return true;
  }

  public getAllTaskSessions(): TaskSessionRecord[] {
    try {
      const raw = this.getStore().get('taskSessions');
      if (!Array.isArray(raw)) return [];
      const sanitized: TaskSessionRecord[] = [];
      for (const item of raw) {
        const session = sanitizeTaskSessionRecord(item);
        if (session) sanitized.push(session);
      }
      return sanitized;
    } catch {
      return [];
    }
  }

  public getTaskSessionsForWorkspace(workspacePath: string, environmentId?: string): TaskSessionRecord[] {
    const all = this.getAllTaskSessions();
    const parsed = parseWorkspaceIdentity(workspacePath);
    const target = {
      environmentId: environmentId || parsed.environmentId,
      path: parsed.path,
    };
    return all.filter((session) => isSameWorkspaceIdentity(
      { environmentId: session.environmentId || LOCAL_ENVIRONMENT_ID, path: session.workspacePath },
      target
    ));
  }

  public getTaskSessionById(taskId: string): TaskSessionRecord | null {
    if (!taskId) return null;
    const all = this.getAllTaskSessions();
    return all.find((s) => s.id === taskId) ?? null;
  }

  public saveTaskSession(sessionInput: unknown): TaskSessionRecord {
    const sanitized = sanitizeTaskSessionRecord(sessionInput);
    if (!sanitized) {
      throw new Error('Invalid task session payload');
    }

    const all = this.getAllTaskSessions();
    const existingIndex = all.findIndex((s) => s.id === sanitized.id);
    const updated = {
      ...sanitized,
      updatedAt: Date.now(),
    };

    let nextList: TaskSessionRecord[];
    if (existingIndex >= 0) {
      nextList = [...all];
      nextList[existingIndex] = updated;
    } else {
      nextList = [...all, updated];
    }

    this.getStore().set('taskSessions', nextList);
    return updated;
  }

  public deleteTaskSession(taskId: string): boolean {
    if (!taskId) return false;
    const all = this.getAllTaskSessions();
    const filtered = all.filter((s) => s.id !== taskId);
    if (filtered.length === all.length) return false;

    this.getStore().set('taskSessions', filtered);
    return true;
  }

  public getAllSshEnvironments(): SshEnvironmentConfig[] {
    try {
      const raw = this.getStore().get('sshEnvironments');
      if (!Array.isArray(raw)) return [];
      const valid: SshEnvironmentConfig[] = [];
      for (const item of raw) {
        const res = validateSshEnvironmentConfig(item);
        if (res.valid) {
          valid.push(res.config);
        }
      }
      return valid;
    } catch {
      return [];
    }
  }

  public getSshEnvironmentById(id: string): SshEnvironmentConfig | null {
    if (!id) return null;
    return this.getAllSshEnvironments().find((env) => env.id === id) ?? null;
  }

  public saveSshEnvironment(input: unknown): SshEnvironmentConfig {
    const validation = validateSshEnvironmentConfig(input);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const all = this.getAllSshEnvironments();
    const existingIndex = all.findIndex((e) => e.id === validation.config.id);
    let nextList: SshEnvironmentConfig[];
    if (existingIndex >= 0) {
      nextList = [...all];
      nextList[existingIndex] = validation.config;
    } else {
      nextList = [...all, validation.config];
    }

    this.getStore().set('sshEnvironments', nextList);
    return validation.config;
  }

  public deleteSshEnvironment(id: string): boolean {
    if (!id) return false;
    const all = this.getAllSshEnvironments();
    const filtered = all.filter((e) => e.id !== id);
    if (filtered.length === all.length) return false;

    this.getStore().set('sshEnvironments', filtered);
    return true;
  }
}
