import { describe, it, expect, beforeEach } from 'vitest';
import type Store from 'electron-store';
import type { StoreSchema } from '../../../src/shared/types/store';
import {
  normalizeWorkspacePath,
  isSameWorkspaceIdentity,
  workspaceIdentityKey,
} from '../../../src/shared/workspaceIdentity';
import {
  WorkspacePersistenceService,
  sanitizeWorkspaceRecipe,
  sanitizeRecipeLaunchStep,
  sanitizeTaskSessionRecord,
} from '../../../src/main/workspacePersistence';

class MemoryStore {
  private data: Record<string, unknown> = {};

  get(key: string): unknown {
    return this.data[key];
  }

  set(key: string, value: unknown): void {
    this.data[key] = value;
  }
}

describe('workspaceIdentity', () => {
  it('normalizes POSIX paths with trailing slashes', () => {
    expect(normalizeWorkspacePath('/home/user/project/')).toBe('/home/user/project');
    expect(normalizeWorkspacePath('/home/user/project///')).toBe('/home/user/project');
    expect(normalizeWorkspacePath('/')).toBe('/');
  });

  it('normalizes Windows backslashes and drive roots', () => {
    expect(normalizeWorkspacePath('C:\\Users\\user\\project\\')).toBe('C:/Users/user/project');
    expect(normalizeWorkspacePath('C:\\')).toBe('C:/');
    expect(normalizeWorkspacePath('C:/')).toBe('C:/');
  });

  it('compares workspace identities case-insensitively on Windows', () => {
    expect(isSameWorkspaceIdentity('C:/Projects/Repo', 'c:/projects/repo/', true)).toBe(true);
    expect(isSameWorkspaceIdentity('C:\\Projects\\Repo', 'c:/projects/repo', true)).toBe(true);
    expect(isSameWorkspaceIdentity('/home/user/Repo', '/home/user/repo', false)).toBe(false);
    expect(isSameWorkspaceIdentity('/home/user/repo/', '/home/user/repo', false)).toBe(true);
  });

  it('preserves remote POSIX case on Windows and separates remote hosts', () => {
    const upper = { environmentId: 'host-a', path: '/home/User/Repo/' };
    const lower = { environmentId: 'host-a', path: '/home/user/repo' };
    expect(isSameWorkspaceIdentity(upper, lower, true)).toBe(false);
    expect(isSameWorkspaceIdentity(upper, { ...upper, environmentId: 'host-b' }, true)).toBe(false);
    expect(isSameWorkspaceIdentity(upper, { ...upper, path: '/home/User/Repo' }, true)).toBe(true);
    expect(isSameWorkspaceIdentity({ environmentId: 'local', path: '/Home/User/Repo' }, '/home/user/repo', true)).toBe(true);
  });

  it('treats delimiter characters in an absolute path as local path content', () => {
    expect(isSameWorkspaceIdentity('/home/foo::bar', { environmentId: 'local', path: '/home/foo::bar' })).toBe(true);
    expect(isSameWorkspaceIdentity('host-a::/repo', { environmentId: 'host-a', path: '/repo' })).toBe(true);
    expect(() => workspaceIdentityKey({ environmentId: 'host::a', path: '/repo' })).toThrow('Invalid workspace environment ID');
  });

  it('returns canonical keys including environmentId', () => {
    expect(workspaceIdentityKey('C:\\Foo\\Bar\\', true)).toBe('local::c:/foo/bar');
    expect(workspaceIdentityKey('/Foo/Bar/', false)).toBe('local::/Foo/Bar');
    expect(workspaceIdentityKey({ environmentId: 'vps-1', path: '/Foo/Bar/' }, false)).toBe('vps-1::/Foo/Bar');
  });

  it('distinguishes local and remote workspaces with identical paths', () => {
    expect(isSameWorkspaceIdentity(
      { environmentId: 'local', path: '/home/user/project' },
      { environmentId: 'dev-vps', path: '/home/user/project' }
    )).toBe(false);
    expect(isSameWorkspaceIdentity(
      { environmentId: 'local', path: '/home/user/project' },
      '/home/user/project'
    )).toBe(true);
  });
  it('falls back to navigator userAgent when process is undefined in browser context', () => {
    const originalProcess = process;
    const originalUserAgent = globalThis.navigator?.userAgent;
    try {
      // @ts-expect-error test override
      globalThis.process = undefined;
      Object.defineProperty(globalThis.navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        configurable: true,
      });
      expect(isSameWorkspaceIdentity('C:/Projects/Repo', 'c:/projects/repo/')).toBe(true);
    } finally {
      globalThis.process = originalProcess;
      if (originalUserAgent !== undefined) {
        Object.defineProperty(globalThis.navigator, 'userAgent', {
          value: originalUserAgent,
          configurable: true,
        });
      } else {
        // @ts-expect-error test cleanup
        delete globalThis.navigator?.userAgent;
      }
    }
  });
});

describe('sanitizeRecipeLaunchStep', () => {
  it('sanitizes valid command step', () => {
    const step = sanitizeRecipeLaunchStep({
      id: 'step-1',
      type: 'command',
      command: 'npm run dev',
      title: 'Dev Server',
    });
    expect(step).toEqual({
      id: 'step-1',
      type: 'command',
      command: 'npm run dev',
      title: 'Dev Server',
    });
  });

  it('sanitizes valid harness step', () => {
    const step = sanitizeRecipeLaunchStep({
      id: 'step-2',
      type: 'harness',
      harnessId: 'codex',
      modelId: 'gpt-5',
    });
    expect(step).toEqual({
      id: 'step-2',
      type: 'harness',
      harnessId: 'codex',
      modelId: 'gpt-5',
    });
  });

  it('rejects invalid steps', () => {
    expect(sanitizeRecipeLaunchStep(null)).toBeNull();
    expect(sanitizeRecipeLaunchStep({})).toBeNull();
    expect(sanitizeRecipeLaunchStep({ id: '1', type: 'command', command: '' })).toBeNull();
    expect(sanitizeRecipeLaunchStep({ id: '2', type: 'harness', harnessId: '' })).toBeNull();
    expect(sanitizeRecipeLaunchStep({ id: '3', type: 'unknown' })).toBeNull();
  });
});

describe('sanitizeWorkspaceRecipe', () => {
  it('sanitizes a full recipe with valid browser and layout', () => {
    const recipe = sanitizeWorkspaceRecipe({
      id: 'rec-1',
      name: 'Full Stack',
      workspacePath: 'C:\\Users\\user\\project\\',
      description: 'Web app with worker',
      terminalCount: 2,
      launches: [
        { id: 'l1', type: 'command', command: 'npm start' },
        { id: 'l2', type: 'harness', harnessId: 'codex' },
        { id: 'l3', type: 'invalid' },
      ],
      browser: { url: 'http://localhost:3000' },
      layout: { root: { type: 'leaf', paneKey: 'terminal:0' }, terminalCount: 2, explorerVisible: true },
      createdAt: 1000,
      updatedAt: 2000,
    });

    expect(recipe).toEqual({
      id: 'rec-1',
      name: 'Full Stack',
      workspacePath: 'C:/Users/user/project',
      environmentId: 'local',
      description: 'Web app with worker',
      terminalCount: 2,
      launches: [
        { id: 'l1', type: 'command', command: 'npm start' },
        { id: 'l2', type: 'harness', harnessId: 'codex' },
      ],
      browser: { url: 'http://localhost:3000/' },
      layout: { root: { type: 'leaf', paneKey: 'terminal:0' }, terminalCount: 2, explorerVisible: true },
      createdAt: 1000,
      updatedAt: 2000,
      version: 1,
    });
  });

  it('drops invalid browser URLs', () => {
    const recipe = sanitizeWorkspaceRecipe({
      id: 'rec-1',
      name: 'Test',
      workspacePath: '/path/to/project',
      launches: [],
      browser: { url: 'javascript:alert(1)' },
    });
    expect(recipe?.browser).toBeUndefined();
  });

  it('rejects recipes without essential fields', () => {
    expect(sanitizeWorkspaceRecipe(null)).toBeNull();
    expect(sanitizeWorkspaceRecipe({})).toBeNull();
    expect(sanitizeWorkspaceRecipe({ id: '', name: 'Test', workspacePath: '/path' })).toBeNull();
    expect(sanitizeWorkspaceRecipe({ id: '1', name: '', workspacePath: '/path' })).toBeNull();
    expect(sanitizeWorkspaceRecipe({ id: '1', name: 'Test', workspacePath: '' })).toBeNull();
  });
});

describe('sanitizeTaskSessionRecord', () => {
  it('sanitizes valid task session record', () => {
    const record = sanitizeTaskSessionRecord({
      id: 'task-1',
      workspacePath: '/home/user/project/',
      harnessId: 'codex',
      modelId: 'gpt-5',
      title: 'Fix issue 42',
      terminalId: 'term-123',
      nativeSessionId: 'sess-abc',
      state: 'running',
      createdAt: 1000,
      updatedAt: 2000,
    });

    expect(record).toEqual({
      id: 'task-1',
      workspacePath: '/home/user/project',
      environmentId: 'local',
      harnessId: 'codex',
      modelId: 'gpt-5',
      title: 'Fix issue 42',
      terminalId: 'term-123',
      nativeSessionId: 'sess-abc',
      state: 'running',
      createdAt: 1000,
      updatedAt: 2000,
      version: 1,
    });
  });

  it('defaults invalid state to unavailable', () => {
    const record = sanitizeTaskSessionRecord({
      id: 'task-1',
      workspacePath: '/project',
      harnessId: 'claude',
      state: 'bogus-state',
    });
    expect(record?.state).toBe('unavailable');
  });

  it('rejects records missing required fields', () => {
    expect(sanitizeTaskSessionRecord(null)).toBeNull();
    expect(sanitizeTaskSessionRecord({})).toBeNull();
    expect(sanitizeTaskSessionRecord({ id: '1', workspacePath: '' })).toBeNull();
    expect(sanitizeTaskSessionRecord({ id: '1', workspacePath: '/p', harnessId: '' })).toBeNull();
  });

  it('migrates path-only task sessions and recipes to local environment', () => {
    const recipe = sanitizeWorkspaceRecipe({
      id: 'rec-legacy',
      name: 'Legacy Recipe',
      workspacePath: '/home/user/legacy',
      launches: [],
    });
    expect(recipe?.environmentId).toBe('local');

    const task = sanitizeTaskSessionRecord({
      id: 'task-legacy',
      workspacePath: '/home/user/legacy',
      harnessId: 'codex',
    });
    expect(task?.environmentId).toBe('local');
  });

  it('preserves non-local environmentId when present', () => {
    const recipe = sanitizeWorkspaceRecipe({
      id: 'rec-remote',
      name: 'Remote Recipe',
      workspacePath: '/home/jay/remote',
      environmentId: 'vps-1',
      launches: [],
    });
    expect(recipe?.environmentId).toBe('vps-1');

    const task = sanitizeTaskSessionRecord({
      id: 'task-remote',
      workspacePath: '/home/jay/remote',
      environmentId: 'vps-1',
      harnessId: 'claude',
    });
    expect(task?.environmentId).toBe('vps-1');
  });

  it('rejects ambiguous environment IDs instead of assigning a record to another workspace', () => {
    expect(sanitizeWorkspaceRecipe({
      id: 'r1', name: 'Recipe', workspacePath: '/repo', environmentId: 'host::other', launches: [],
    })).toBeNull();
    expect(sanitizeTaskSessionRecord({
      id: 't1', harnessId: 'codex', workspacePath: '/repo', environmentId: 'host::other',
    })).toBeNull();
  });
});

describe('WorkspacePersistenceService', () => {
  let memoryStore: MemoryStore;
  let service: WorkspacePersistenceService;

  beforeEach(() => {
    memoryStore = new MemoryStore();
    service = new WorkspacePersistenceService(() => memoryStore as unknown as Store<StoreSchema>);
  });

  it('returns empty lists for empty or invalid store', () => {
    expect(service.getAllRecipes()).toEqual([]);
    expect(service.getAllTaskSessions()).toEqual([]);

    memoryStore.set('workspaceRecipes', 'not-an-array');
    memoryStore.set('taskSessions', { invalid: true });
    expect(service.getAllRecipes()).toEqual([]);
    expect(service.getAllTaskSessions()).toEqual([]);
  });

  it('saves and updates recipes with path normalization', () => {
    const saved = service.saveRecipe({
      id: 'r1',
      name: 'First Recipe',
      workspacePath: '/home/user/project/',
      launches: [{ id: 's1', type: 'command', command: 'npm test' }],
    });

    expect(saved.workspacePath).toBe('/home/user/project');
    expect(service.getAllRecipes().length).toBe(1);

    // Update
    service.saveRecipe({
      id: 'r1',
      name: 'Updated Recipe Name',
      workspacePath: '/home/user/project',
      launches: [],
    });

    const all = service.getAllRecipes();
    expect(all.length).toBe(1);
    expect(all[0].name).toBe('Updated Recipe Name');
  });

  it('filters recipes by workspace path identity', () => {
    service.saveRecipe({
      id: 'r1',
      name: 'P1 Recipe',
      workspacePath: '/home/user/project1',
      launches: [],
    });
    service.saveRecipe({
      id: 'r2',
      name: 'P2 Recipe',
      workspacePath: '/home/user/project2',
      launches: [],
    });

    const forP1 = service.getRecipesForWorkspace('/home/user/project1/');
    expect(forP1.length).toBe(1);
    expect(forP1[0].id).toBe('r1');
  });

  it('loads legacy recipes as local without mixing same-path remote recipes', () => {
    memoryStore.set('workspaceRecipes', [
      { id: 'legacy', name: 'Legacy', workspacePath: '/repo', launches: [] },
      { id: 'host-a-upper', name: 'Upper', workspacePath: '/Repo', environmentId: 'host-a', launches: [] },
      { id: 'host-a-lower', name: 'Lower', workspacePath: '/repo', environmentId: 'host-a', launches: [] },
      { id: 'host-b', name: 'Other host', workspacePath: '/repo', environmentId: 'host-b', launches: [] },
    ]);
    expect(service.getRecipesForWorkspace('/repo').map((r) => [r.id, r.environmentId])).toEqual([['legacy', 'local']]);
    expect(service.getRecipesForWorkspace('/Repo', 'host-a').map((r) => r.id)).toEqual(['host-a-upper']);
    expect(service.getRecipesForWorkspace('host-a::/repo').map((r) => r.id)).toEqual(['host-a-lower']);
    expect(service.getRecipesForWorkspace('/repo', 'host-b').map((r) => r.id)).toEqual(['host-b']);
  });

  it('deletes recipes by ID', () => {
    service.saveRecipe({ id: 'r1', name: 'R1', workspacePath: '/p', launches: [] });
    service.saveRecipe({ id: 'r2', name: 'R2', workspacePath: '/p', launches: [] });

    expect(service.deleteRecipe('r1')).toBe(true);
    expect(service.deleteRecipe('r1')).toBe(false);
    expect(service.getAllRecipes().length).toBe(1);
    expect(service.getRecipeById('r2')?.id).toBe('r2');
  });

  it('saves and updates task sessions', () => {
    const saved = service.saveTaskSession({
      id: 't1',
      workspacePath: '/home/user/repo/',
      harnessId: 'codex',
      title: 'Build feature',
      state: 'running',
    });

    expect(saved.workspacePath).toBe('/home/user/repo');
    expect(service.getAllTaskSessions().length).toBe(1);

    // Update state to resumable
    service.saveTaskSession({
      ...saved,
      state: 'resumable',
      terminalId: undefined,
      nativeSessionId: 'sess-123',
    });

    const all = service.getAllTaskSessions();
    expect(all.length).toBe(1);
    expect(all[0].state).toBe('resumable');
    expect(all[0].nativeSessionId).toBe('sess-123');
  });

  it('filters task sessions by workspace path', () => {
    service.saveTaskSession({ id: 't1', workspacePath: '/repo1', harnessId: 'codex', state: 'resumable' });
    service.saveTaskSession({ id: 't2', workspacePath: '/repo2', harnessId: 'claude', state: 'resumable' });

    const sessions = service.getTaskSessionsForWorkspace('/repo1/');
    expect(sessions.length).toBe(1);
    expect(sessions[0].id).toBe('t1');
  });

  it('loads legacy task sessions as local without mixing same-path remote sessions', () => {
    memoryStore.set('taskSessions', [
      { id: 'legacy', workspacePath: '/repo', harnessId: 'codex' },
      { id: 'host-a-upper', workspacePath: '/Repo', environmentId: 'host-a', harnessId: 'codex' },
      { id: 'host-a-lower', workspacePath: '/repo', environmentId: 'host-a', harnessId: 'codex' },
      { id: 'host-b', workspacePath: '/repo', environmentId: 'host-b', harnessId: 'codex' },
    ]);
    expect(service.getTaskSessionsForWorkspace('/repo').map((r) => [r.id, r.environmentId])).toEqual([['legacy', 'local']]);
    expect(service.getTaskSessionsForWorkspace('/Repo', 'host-a').map((r) => r.id)).toEqual(['host-a-upper']);
    expect(service.getTaskSessionsForWorkspace('host-a::/repo').map((r) => r.id)).toEqual(['host-a-lower']);
    expect(service.getTaskSessionsForWorkspace('/repo', 'host-b').map((r) => r.id)).toEqual(['host-b']);
  });

  it('deletes task session by ID', () => {
    service.saveTaskSession({ id: 't1', workspacePath: '/repo', harnessId: 'codex', state: 'resumable' });
    expect(service.deleteTaskSession('t1')).toBe(true);
    expect(service.deleteTaskSession('t1')).toBe(false);
    expect(service.getAllTaskSessions()).toEqual([]);
  });

  it('manages saved SSH environments and rejects invalid targets', () => {
    expect(service.getAllSshEnvironments()).toEqual([]);

    const saved = service.saveSshEnvironment({
      id: 'env-1',
      kind: 'ssh',
      label: 'Production VPS',
      target: 'deploy@192.168.1.100',
    });

    expect(saved).toEqual({
      id: 'env-1',
      kind: 'ssh',
      label: 'Production VPS',
      target: 'deploy@192.168.1.100',
    });
    expect(service.getSshEnvironmentById('env-1')?.label).toBe('Production VPS');

    // Rejects option injection
    expect(() => service.saveSshEnvironment({
      id: 'env-bad',
      kind: 'ssh',
      label: 'Bad target',
      target: '-oProxyCommand=calc.exe host',
    })).toThrow();

    expect(() => service.saveSshEnvironment({
      id: 'env::bad',
      kind: 'ssh',
      label: 'Ambiguous identity',
      target: 'host.example',
    })).toThrow();

    // Rejects shell metacharacters
    expect(() => service.saveSshEnvironment({
      id: 'env-bad2',
      kind: 'ssh',
      label: 'Bad target',
      target: 'host; rm -rf /',
    })).toThrow();

    // Deletes environment
    expect(service.deleteSshEnvironment('env-1')).toBe(true);
    expect(service.deleteSshEnvironment('env-1')).toBe(false);
    expect(service.getAllSshEnvironments()).toEqual([]);
  });

  it('persists, updates, and clears the optional per-host workspace root', () => {
    const config = { id: 'root-host', kind: 'ssh', label: 'Host', target: 'host' };
    service.saveSshEnvironment({ ...config, defaultWorkspaceRoot: '/srv/repos' });
    expect(service.getSshEnvironmentById(config.id)?.defaultWorkspaceRoot).toBe('/srv/repos');
    service.saveSshEnvironment({ ...config, defaultWorkspaceRoot: '/opt/projects' });
    expect(service.getAllSshEnvironments()).toHaveLength(1);
    expect(service.getSshEnvironmentById(config.id)?.defaultWorkspaceRoot).toBe('/opt/projects');
    service.saveSshEnvironment({ ...config, defaultWorkspaceRoot: '' });
    expect(service.getSshEnvironmentById(config.id)).not.toHaveProperty('defaultWorkspaceRoot');
  });
});
