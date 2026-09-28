import { describe, it, expect, vi } from 'vitest';
import type { WorkspaceRecipe } from '../../../src/shared/types/recipes';
import { executeWorkspaceRecipe } from '../../../src/renderer/lib/recipeExecution';

describe('executeWorkspaceRecipe', () => {
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
      status: 'success',
      terminalId: 'term-2',
    });
    expect(result.steps[2]).toEqual({
      id: 'browser',
      type: 'browser',
      status: 'success',
    });

    expect(deps.spawnTerminal).toHaveBeenNthCalledWith(1, '/projects/my-app', 'codex', 'gpt-5');
    expect(deps.spawnTerminal).toHaveBeenNthCalledWith(2, '/projects/my-app', undefined, undefined, 'npm run dev');
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
});
