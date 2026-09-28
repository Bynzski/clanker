import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Store from 'electron-store';
import type { StoreSchema } from '../../../src/shared/types/store';
import {
  RECIPE_GET_ALL,
  RECIPE_SAVE,
  RECIPE_DELETE,
} from '../../../src/shared/ipcChannels';

const { mockHandle } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: mockHandle,
  },
}));

import { registerRecipeIpc } from '../../../src/main/ipc/recipeIpc';

class MemoryStore {
  private data: Record<string, unknown> = {};

  get(key: string): unknown {
    return this.data[key];
  }

  set(key: string, value: unknown): void {
    this.data[key] = value;
  }
}

describe('recipeIpc', () => {
  let memoryStore: MemoryStore;
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    memoryStore = new MemoryStore();
    handlers = new Map();
    mockHandle.mockReset();
    mockHandle.mockImplementation((channel: string, listener: (...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    });
  });

  it('registers all recipe IPC channels', () => {
    registerRecipeIpc({
      getStore: () => memoryStore as unknown as Store<StoreSchema>,
    });

    expect(handlers.has(RECIPE_GET_ALL)).toBe(true);
    expect(handlers.has(RECIPE_SAVE)).toBe(true);
    expect(handlers.has(RECIPE_DELETE)).toBe(true);
  });

  it('handles RECIPE_SAVE, RECIPE_GET_ALL, and RECIPE_DELETE', async () => {
    const getSafeWorkspacePath = vi.fn((dir: string) => dir);
    registerRecipeIpc({
      getStore: () => memoryStore as unknown as Store<StoreSchema>,
      getSafeWorkspacePath,
    });

    const saveHandler = handlers.get(RECIPE_SAVE)!;
    const getAllHandler = handlers.get(RECIPE_GET_ALL)!;
    const deleteHandler = handlers.get(RECIPE_DELETE)!;

    // Save recipe
    const saved = await saveHandler(null, {
      id: 'rec-1',
      name: 'Full Stack App',
      workspacePath: '/home/user/project/',
      launches: [
        { id: 'step-1', type: 'command', command: 'npm run dev' },
        { id: 'step-2', type: 'harness', harnessId: 'codex' },
      ],
      browser: { url: 'http://localhost:5173' },
    }) as { id: string; workspacePath: string };

    expect(saved.id).toBe('rec-1');
    expect(saved.workspacePath).toBe('/home/user/project');
    expect(getSafeWorkspacePath).toHaveBeenCalled();

    // Get all
    const all = await getAllHandler(null) as Array<{ id: string }>;
    expect(all.length).toBe(1);
    expect(all[0].id).toBe('rec-1');

    // Get filtered by workspace
    const filtered = await getAllHandler(null, '/home/user/project') as Array<{ id: string }>;
    expect(filtered.length).toBe(1);

    const emptyFilter = await getAllHandler(null, '/home/user/other') as Array<{ id: string }>;
    expect(emptyFilter.length).toBe(0);

    // Delete
    const deleted = await deleteHandler(null, 'rec-1');
    expect(deleted).toBe(true);

    const remaining = await getAllHandler(null) as Array<{ id: string }>;
    expect(remaining.length).toBe(0);
  });

  it('rejects invalid recipe save payloads', async () => {
    registerRecipeIpc({
      getStore: () => memoryStore as unknown as Store<StoreSchema>,
    });

    const saveHandler = handlers.get(RECIPE_SAVE)!;
    await expect(saveHandler(null, null)).rejects.toThrow('Invalid recipe payload');
    await expect(saveHandler(null, { id: '', name: 'Test' })).rejects.toThrow();
  });
});
