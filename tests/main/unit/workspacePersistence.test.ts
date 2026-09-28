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

  it('returns canonical keys', () => {
    expect(workspaceIdentityKey('C:\\Foo\\Bar\\', true)).toBe('c:/foo/bar');
    expect(workspaceIdentityKey('/Foo/Bar/', false)).toBe('/Foo/Bar');
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

  it('deletes task session by ID', () => {
    service.saveTaskSession({ id: 't1', workspacePath: '/repo', harnessId: 'codex', state: 'resumable' });
    expect(service.deleteTaskSession('t1')).toBe(true);
    expect(service.deleteTaskSession('t1')).toBe(false);
    expect(service.getAllTaskSessions()).toEqual([]);
  });
});
