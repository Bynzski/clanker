import { afterAll, describe, it, expect } from 'vitest';
import Conf from 'conf';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeWorkspaceNavigationMode } from '../../../src/shared/types/workspaceNavigation';
import type Store from 'electron-store';
import type { StoreSchema } from '../../../src/shared/types/store';
import {
  LEGACY_TASK_SESSIONS_KEY,
  purgeLegacyTaskSessions,
  seedWorkspaceNavigationMode,
} from '../../../src/main/storeMigrations';

function memoryStore(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  const own = (key: string) => Object.prototype.hasOwnProperty.call(data, key);
  const store = {
    get: (key: string) => data[key],
    set: (key: string, value: unknown) => { data[key] = value; },
    has: (key: string) => own(key),
    delete: (key: string) => own(key) && delete data[key],
  };
  return { store: store as unknown as Store<StoreSchema>, data };
}

describe('purgeLegacyTaskSessions', () => {
  it('deletes persisted Workspace Tasks records once', () => {
    const { store, data } = memoryStore({
      [LEGACY_TASK_SESSIONS_KEY]: [{ id: 'task-1' }, { id: 'task-2' }],
      workspaceRecipes: [],
    });

    expect(purgeLegacyTaskSessions(store)).toBe(true);
    expect(Object.keys(data)).not.toContain(LEGACY_TASK_SESSIONS_KEY);
    expect(data.workspaceRecipes).toEqual([]);
  });

  it('is a no-op when no legacy records exist', () => {
    const { store, data } = memoryStore({ workspaceRecipes: [] });

    expect(purgeLegacyTaskSessions(store)).toBe(false);
    expect(Object.keys(data)).toEqual(['workspaceRecipes']);
  });
});
describe('seedWorkspaceNavigationMode (real conf semantics)', () => {
  const defaults = { theme: 'dark', lastWorkspace: '/home/me', workspaceRecipes: [] };
  const dirs: string[] = [];
  afterAll(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

  function open(dir: string) {
    const file = join(dir, 'config.json');
    const existed = existsSync(file);
    const store = new Conf<Record<string, unknown>>({ cwd: dir, defaults }) as unknown as Store<StoreSchema>;
    return { store, existed, file };
  }
  const tmp = () => { const dir = mkdtempSync(join(tmpdir(), 'clanker-store-')); dirs.push(dir); return dir; };

  it('confirms defaults make lastWorkspace present on a brand-new store (so it cannot signal an upgrade)', () => {
    const { store, existed } = open(tmp());
    expect(existed).toBe(false);
    expect(store.get('lastWorkspace')).toBe('/home/me');
    expect(store.has('lastWorkspace')).toBe(true);
  });

  it('fresh install → sidebar, and the choice is persisted', () => {
    const dir = tmp();
    const { store, existed } = open(dir);
    expect(seedWorkspaceNavigationMode(store, existed)).toBe('sidebar');
    expect(open(dir).store.get('workspaceNavigationMode')).toBe('sidebar');
  });

  it('legacy store without a mode → tabs, and a later launch does not flip it', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ theme: 'dark', lastWorkspace: '/old' }));
    const first = open(dir);
    expect(first.existed).toBe(true);
    expect(seedWorkspaceNavigationMode(first.store, first.existed)).toBe('tabs');
    const second = open(dir);
    expect(seedWorkspaceNavigationMode(second.store, second.existed)).toBeNull();
    expect(second.store.get('workspaceNavigationMode')).toBe('tabs');
  });

  it('a fresh install is still sidebar on its second launch (decision already persisted)', () => {
    const dir = tmp();
    const first = open(dir);
    seedWorkspaceNavigationMode(first.store, first.existed);
    const second = open(dir);
    expect(second.existed).toBe(true);
    expect(seedWorkspaceNavigationMode(second.store, second.existed)).toBeNull();
    expect(second.store.get('workspaceNavigationMode')).toBe('sidebar');
  });

  it.each(['tabs', 'sidebar'] as const)('explicit persisted %s always wins', (mode) => {
    for (const existed of [true, false]) {
      const { store } = memoryStore({ workspaceNavigationMode: mode });
      expect(seedWorkspaceNavigationMode(store, existed)).toBeNull();
      expect(store.get('workspaceNavigationMode')).toBe(mode);
    }
  });

  it('leaves a corrupt value alone so normalization (sidebar default) handles it', () => {
    const { store } = memoryStore({ workspaceNavigationMode: 'rail' });
    expect(seedWorkspaceNavigationMode(store, true)).toBeNull();
    expect(store.get('workspaceNavigationMode')).toBe('rail');
    expect(normalizeWorkspaceNavigationMode(store.get('workspaceNavigationMode'))).toBe('sidebar');
  });
});
