import { describe, it, expect, vi } from 'vitest';
import type { WorkspaceRecipe } from '../../../src/shared/types/recipes';
import { executeWorkspaceRecipe } from '../../../src/renderer/lib/recipeExecution';
import { captureTerminalLaunches } from '../../../src/renderer/lib/recipeCapture';
import { WorkspacePersistenceService } from '../../../src/main/workspacePersistence';
import type Store from 'electron-store';
import type { StoreSchema } from '../../../src/shared/types/store';

describe('executeWorkspaceRecipe', () => {
  const previewRecipe: WorkspaceRecipe = {
    id: 'preview', name: 'Preview', workspacePath: '/projects/repo',
    launches: [{ id: 'cmd', type: 'command', command: 'npm run dev' }],
    browser: { url: 'http://localhost:5173' },
    createdAt: 1, updatedAt: 1, version: 1,
  };

  it('reports a PTY command exit failure while keeping its spawned terminal', async () => {
    const spawned = vi.fn();
    const result = await executeWorkspaceRecipe({ ...previewRecipe, browser: undefined }, {
      ensureWorkspaceOpen: vi.fn().mockResolvedValue('ws-1'),
      spawnTerminal: vi.fn().mockResolvedValue({ id: 'term-1', pid: 101 }),
      onTerminalSpawned: spawned,
      waitRecipeCommand: vi.fn().mockResolvedValue({ status: 'failed', error: 'Command exited immediately with code 1' }),
      getExistingTerminalCount: () => 0,
    });
    expect(result.success).toBe(false);
    expect(result.steps[0]).toMatchObject({ type: 'command', status: 'failed', terminalId: 'term-1',
      error: 'Command exited immediately with code 1' });
    expect(spawned).toHaveBeenCalledOnce();
  });

  it('reports an unavailable local preview while preserving successful terminals', async () => {
    const spawnTerminal = vi.fn().mockResolvedValue({ id: 'term-1', pid: 101 });
    const onTerminalSpawned = vi.fn();
    const openBrowserPreview = vi.fn();
    const probePreview = vi.fn()
      .mockResolvedValueOnce({ status: 'unavailable', host: 'localhost', port: 5173 })
      .mockResolvedValueOnce({ status: 'unavailable', host: 'localhost', port: 5173 });
    const result = await executeWorkspaceRecipe(previewRecipe, {
      ensureWorkspaceOpen: vi.fn().mockResolvedValue('ws-1'), spawnTerminal, onTerminalSpawned,
      waitRecipeCommand: vi.fn().mockResolvedValue({ status: 'started' }),
      probePreview, openBrowserPreview, getExistingTerminalCount: () => 0,
    });
    expect(result.steps).toEqual([
      { id: 'cmd', type: 'command', status: 'started', terminalId: 'term-1' },
      { id: 'browser', type: 'browser', status: 'failed', error: 'Preview did not become available on localhost:5173' },
    ]);
    expect(result.success).toBe(false);
    expect(onTerminalSpawned).toHaveBeenCalledOnce();
    expect(openBrowserPreview).not.toHaveBeenCalled();
  });

  it('navigates when a local preview becomes ready during the retry window', async () => {
    const openBrowserPreview = vi.fn().mockResolvedValue(true);
    const probePreview = vi.fn()
      .mockResolvedValueOnce({ status: 'unavailable', host: 'localhost', port: 5173 })
      .mockResolvedValueOnce({ status: 'ready', host: 'localhost', port: 5173 });
    const result = await executeWorkspaceRecipe(previewRecipe, {
      ensureWorkspaceOpen: vi.fn().mockResolvedValue('ws-1'),
      spawnTerminal: vi.fn().mockResolvedValue({ id: 'term-1', pid: 101 }),
      onTerminalSpawned: vi.fn(), waitRecipeCommand: vi.fn().mockResolvedValue({ status: 'started' }),
      probePreview, openBrowserPreview, getExistingTerminalCount: () => 0,
    });
    expect(result.success).toBe(true);
    expect(result.steps[1]).toMatchObject({ type: 'browser', status: 'success' });
    expect(openBrowserPreview).toHaveBeenCalledWith('ws-1', 'http://localhost:5173');
  });

  it('stops before command launch when the configured preview port is occupied', async () => {
    const spawnTerminal = vi.fn();
    const result = await executeWorkspaceRecipe(previewRecipe, {
      ensureWorkspaceOpen: vi.fn().mockResolvedValue('ws-1'), spawnTerminal,
      onTerminalSpawned: vi.fn(), probePreview: vi.fn().mockResolvedValue({ status: 'ready', host: 'localhost', port: 5173 }),
      getExistingTerminalCount: () => 0,
    });
    expect(result).toMatchObject({ success: false, steps: [{ type: 'browser', status: 'failed',
      error: 'Port 5173 is already in use on localhost' }] });
    expect(spawnTerminal).not.toHaveBeenCalled();
  });

  it('lets a remote preview use normal browser navigation without local retry', async () => {
    const probePreview = vi.fn().mockResolvedValue({ status: 'remote' });
    const openBrowserPreview = vi.fn().mockResolvedValue(true);
    const result = await executeWorkspaceRecipe({ ...previewRecipe, browser: { url: 'https://example.com' } }, {
      ensureWorkspaceOpen: vi.fn().mockResolvedValue('ws-1'),
      spawnTerminal: vi.fn().mockResolvedValue({ id: 'term-1', pid: 101 }),
      onTerminalSpawned: vi.fn(), waitRecipeCommand: vi.fn().mockResolvedValue({ status: 'started' }),
      probePreview, openBrowserPreview, getExistingTerminalCount: () => 0,
    });
    expect(result.success).toBe(true);
    expect(probePreview).toHaveBeenCalledTimes(1);
    expect(probePreview).toHaveBeenCalledWith('https://example.com', false);
    expect(openBrowserPreview).toHaveBeenCalledWith('ws-1', 'https://example.com');
  });

  it('rejects explicit steps in a populated workspace before spawning or restoring layout', async () => {
    const spawnTerminal = vi.fn();
    const restoreLayout = vi.fn();
    const result = await executeWorkspaceRecipe({ ...previewRecipe, browser: undefined,
      layout: { root: { type: 'leaf', paneKey: 'terminal:0' }, terminalCount: 1 } }, {
      ensureWorkspaceOpen: vi.fn().mockResolvedValue('ws-1'), spawnTerminal,
      onTerminalSpawned: vi.fn(), getExistingTerminalCount: () => 2, restoreLayout,
    });
    expect(result.success).toBe(false);
    expect(result.steps[0].error).toMatch(/already has active terminals/);
    expect(spawnTerminal).not.toHaveBeenCalled();
    expect(restoreLayout).not.toHaveBeenCalled();
  });
  it.each([
    ['shell then Codex', [null, 'codex'], ['shell', 'harness']],
    ['Codex then shell', ['codex', null], ['harness', 'shell']],
  ] as const)('preserves captured %s slots through save, reload, and split layout restore', async (_name, harnesses, types) => {
    const captured = captureTerminalLaunches(harnesses.map((harnessId) => ({ harnessId })));
    const storage = new Map<string, unknown>();
    const persistence = new WorkspacePersistenceService(() => ({
      get: (key: string) => storage.get(key),
      set: (key: string, value: unknown) => { storage.set(key, value); },
    }) as unknown as Store<StoreSchema>);
    const saved = persistence.saveRecipe({
      id: 'mixed', name: 'Mixed', workspacePath: '/projects/repo',
      terminalCount: 2, launches: captured,
      layout: {
        root: { type: 'split', orientation: 'horizontal', ratio: 0.5,
          first: { type: 'leaf', paneKey: 'terminal:0' },
          second: { type: 'leaf', paneKey: 'terminal:1' } },
        terminalCount: 2,
      },
    });
    expect(saved.launches).toHaveLength(2);
    const reloaded = persistence.getRecipeById('mixed');
    expect(reloaded?.launches.map((step) => step.type)).toEqual(types);

    const spawned: { harnessId: string | null }[] = [];
    const deps = {
      ensureWorkspaceOpen: vi.fn().mockResolvedValue('ws-1'),
      spawnTerminal: vi.fn().mockResolvedValueOnce({ id: 'term-1', pid: 1 })
        .mockResolvedValueOnce({ id: 'term-2', pid: 2, harnessId: 'codex' }),
      onTerminalSpawned: vi.fn((_id: string, term: { harnessId: string | null }) => spawned.push(term)),
      restoreLayout: vi.fn(() => expect(spawned).toHaveLength(2)),
    };
    const result = await executeWorkspaceRecipe(reloaded!, deps);
    expect(result.success).toBe(true);
    expect(result.steps.map((step) => step.type)).toEqual(types);
    expect(deps.spawnTerminal).toHaveBeenCalledTimes(2);
    for (const [index, type] of types.entries()) {
      expect(deps.spawnTerminal).toHaveBeenNthCalledWith(index + 1, '/projects/repo', ...(type === 'shell' ? [] : ['codex', undefined]));
    }
    expect(deps.restoreLayout).toHaveBeenCalledWith('ws-1', reloaded?.layout);
  });

  it('launches shell, command, and Codex slots in order', async () => {
    const recipe: WorkspaceRecipe = {
      id: 'three', name: 'Three', workspacePath: '/projects/repo', terminalCount: 3,
      launches: [{ id: 's1', type: 'shell' }, { id: 's2', type: 'command', command: 'npm run dev' },
        { id: 's3', type: 'harness', harnessId: 'codex' }],
      createdAt: 1, updatedAt: 1, version: 1,
    };
    const deps = {
      ensureWorkspaceOpen: vi.fn().mockResolvedValue('ws-1'),
      spawnTerminal: vi.fn().mockResolvedValue({ id: 'term', pid: 1 }),
      onTerminalSpawned: vi.fn(),
    };
    const result = await executeWorkspaceRecipe(recipe, deps);
    expect(result.steps.map((step) => step.type)).toEqual(['shell', 'command', 'harness']);
    expect(deps.spawnTerminal).toHaveBeenNthCalledWith(1, '/projects/repo');
    expect(deps.spawnTerminal).toHaveBeenNthCalledWith(2, '/projects/repo', undefined, undefined, 'npm run dev', true);
    expect(deps.spawnTerminal).toHaveBeenNthCalledWith(3, '/projects/repo', 'codex', undefined);
  });
  const sampleRecipe: WorkspaceRecipe = {
    id: 'recipe-1',
    name: 'Dev Environment',
    workspacePath: '/projects/my-app',
    launches: [
      { id: 'step-1', type: 'harness', harnessId: 'codex', modelId: 'gpt-5' },
      { id: 'step-2', type: 'command', command: 'npm run dev' },
    ],
    browser: { url: 'http://localhost:3000' },
    createdAt: 1000,
    updatedAt: 1000,
    version: 1,
  };

  it('successfully launches all steps and browser preview', async () => {
    const spawnedTerminals: unknown[] = [];
    const deps = {
      ensureWorkspaceOpen: vi.fn().mockResolvedValue('ws-1'),
      spawnTerminal: vi.fn()
        .mockResolvedValueOnce({ id: 'term-1', pid: 101, harnessId: 'codex' })
        .mockResolvedValueOnce({ id: 'term-2', pid: 102 }),
      onTerminalSpawned: vi.fn((_wsId, term) => spawnedTerminals.push(term)),
      openBrowserPreview: vi.fn().mockResolvedValue(true),
    };

    const result = await executeWorkspaceRecipe(sampleRecipe, deps);

    expect(result.success).toBe(true);
    expect(result.steps.length).toBe(3);
    expect(result.steps[0]).toEqual({
      id: 'step-1',
      type: 'harness',
      status: 'success',
      terminalId: 'term-1',
    });
    expect(result.steps[1]).toEqual({
      id: 'step-2',
      type: 'command',
      status: 'started',
      terminalId: 'term-2',
    });
    expect(result.steps[2]).toEqual({
      id: 'browser',
      type: 'browser',
      status: 'success',
    });

    expect(deps.spawnTerminal).toHaveBeenNthCalledWith(1, '/projects/my-app', 'codex', 'gpt-5');
    expect(deps.spawnTerminal).toHaveBeenNthCalledWith(2, '/projects/my-app', undefined, undefined, 'npm run dev', true);
    expect(deps.openBrowserPreview).toHaveBeenCalledWith('ws-1', 'http://localhost:3000');
    expect(spawnedTerminals.length).toBe(2);
  });

  it('handles partial failure gracefully without aborting or rolling back prior steps', async () => {
    const spawnedTerminals: unknown[] = [];
    const deps = {
      ensureWorkspaceOpen: vi.fn().mockResolvedValue('ws-1'),
      spawnTerminal: vi.fn()
        .mockResolvedValueOnce({ id: 'term-1', pid: 101, harnessId: 'codex' })
        .mockRejectedValueOnce(new Error('Command not found: npm run dev')),
      onTerminalSpawned: vi.fn((_wsId, term) => spawnedTerminals.push(term)),
      openBrowserPreview: vi.fn().mockResolvedValue(false), // browser fails
    };

    const result = await executeWorkspaceRecipe(sampleRecipe, deps);

    expect(result.success).toBe(false);
    expect(result.steps.length).toBe(3);

    // Terminal 1 succeeded and remains
    expect(result.steps[0].status).toBe('success');
    expect(result.steps[0].terminalId).toBe('term-1');
    expect(spawnedTerminals.length).toBe(1);

    // Terminal 2 failed
    expect(result.steps[1].status).toBe('failed');
    expect(result.steps[1].error).toContain('Command not found');

    // Browser failed
    expect(result.steps[2].status).toBe('failed');
  });

  it('returns failure if workspace cannot be opened', async () => {
    const deps = {
      ensureWorkspaceOpen: vi.fn().mockResolvedValue(null),
      spawnTerminal: vi.fn(),
      onTerminalSpawned: vi.fn(),
    };

    const result = await executeWorkspaceRecipe(sampleRecipe, deps);

    expect(result.success).toBe(false);
    expect(result.steps[0].status).toBe('failed');
    expect(deps.spawnTerminal).not.toHaveBeenCalled();
  });
  it('calls restoreLayout when recipe includes layout configuration', async () => {
    const restoreLayoutMock = vi.fn();
    const recipeWithLayout: WorkspaceRecipe = {
      ...sampleRecipe,
      layout: {
        root: { type: 'leaf', paneKey: 'terminal:0' },
        terminalCount: 2,
        explorerVisible: true,
      },
    };

    const deps = {
      ensureWorkspaceOpen: vi.fn().mockResolvedValue('ws-1'),
      spawnTerminal: vi.fn().mockResolvedValue({ id: 'term-1', pid: 101 }),
      onTerminalSpawned: vi.fn(),
      restoreLayout: restoreLayoutMock,
    };

    const result = await executeWorkspaceRecipe(recipeWithLayout, deps);
    expect(result.success).toBe(true);
    expect(restoreLayoutMock).toHaveBeenCalledWith('ws-1', recipeWithLayout.layout);
  });

  it('tolerates errors in restoreLayout gracefully', async () => {
    const recipeWithLayout: WorkspaceRecipe = {
      ...sampleRecipe,
      layout: {
        root: { type: 'leaf', paneKey: 'terminal:0' },
        terminalCount: 2,
      },
    };

    const deps = {
      ensureWorkspaceOpen: vi.fn().mockResolvedValue('ws-1'),
      spawnTerminal: vi.fn().mockResolvedValue({ id: 'term-1', pid: 101 }),
      onTerminalSpawned: vi.fn(),
      restoreLayout: vi.fn().mockImplementation(() => {
        throw new Error('Incompatible layout');
      }),
    };

    const result = await executeWorkspaceRecipe(recipeWithLayout, deps);
    expect(result.success).toBe(true);
  });

  it('creates plain terminals before restoring layout for recipes with zero launches', async () => {
    const spawnedTerminals: unknown[] = [];
    const restoreLayoutMock = vi.fn();

    const zeroLaunchRecipe: WorkspaceRecipe = {
      id: 'recipe-zero-launch',
      name: 'Two Terminals Split',
      workspacePath: '/projects/repo',
      terminalCount: 2,
      launches: [],
      layout: {
        root: {
          type: 'split',
          orientation: 'horizontal',
          ratio: 0.5,
          first: { type: 'leaf', paneKey: 'terminal:0' },
          second: { type: 'leaf', paneKey: 'terminal:1' },
        },
        terminalCount: 2,
      },
      createdAt: 1000,
      updatedAt: 1000,
      version: 1,
    };

    const deps = {
      ensureWorkspaceOpen: vi.fn().mockResolvedValue('ws-1'),
      spawnTerminal: vi.fn()
        .mockResolvedValueOnce({ id: 'term-shell-1', pid: 101 })
        .mockResolvedValueOnce({ id: 'term-shell-2', pid: 102 }),
      onTerminalSpawned: vi.fn((_wsId, term) => spawnedTerminals.push(term)),
      restoreLayout: restoreLayoutMock,
      getExistingTerminalCount: vi.fn().mockReturnValue(0),
    };

    const result = await executeWorkspaceRecipe(zeroLaunchRecipe, deps);

    expect(result.success).toBe(true);
    expect(result.steps.length).toBe(2);
    expect(spawnedTerminals.length).toBe(2);

    // restoreLayout was called after both terminals were created
    expect(restoreLayoutMock).toHaveBeenCalledWith('ws-1', zeroLaunchRecipe.layout);
  });

  it('handles partial failure of fallback shell creation without tearing down workspace', async () => {
    const spawnedTerminals: unknown[] = [];
    const restoreLayoutMock = vi.fn();

    const zeroLaunchRecipe: WorkspaceRecipe = {
      id: 'recipe-zero-fail',
      name: 'Two Terminals',
      workspacePath: '/projects/repo',
      terminalCount: 2,
      launches: [],
      createdAt: 1000,
      updatedAt: 1000,
      version: 1,
    };

    const deps = {
      ensureWorkspaceOpen: vi.fn().mockResolvedValue('ws-1'),
      spawnTerminal: vi.fn()
        .mockResolvedValueOnce({ id: 'term-shell-1', pid: 101 })
        .mockRejectedValueOnce(new Error('Shell spawn failed')),
      onTerminalSpawned: vi.fn((_wsId, term) => spawnedTerminals.push(term)),
      restoreLayout: restoreLayoutMock,
      getExistingTerminalCount: vi.fn().mockReturnValue(0),
    };

    const result = await executeWorkspaceRecipe(zeroLaunchRecipe, deps);

    expect(result.success).toBe(false);
    expect(result.steps.length).toBe(2);
    // Successful terminal remains
    expect(result.steps[0].status).toBe('success');
    expect(result.steps[1].status).toBe('failed');
    expect(result.steps[1].error).toContain('Shell spawn failed');
    expect(spawnedTerminals.length).toBe(1);
  });
});
