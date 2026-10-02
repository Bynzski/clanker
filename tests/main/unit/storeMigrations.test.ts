import { describe, it, expect } from 'vitest';
import type Store from 'electron-store';
import type { StoreSchema } from '../../../src/shared/types/store';
import {
  LEGACY_TASK_SESSIONS_KEY,
  purgeLegacyTaskSessions,
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