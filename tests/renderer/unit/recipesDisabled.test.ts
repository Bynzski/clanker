import { describe, expect, it, vi } from 'vitest';
import { executeWorkspaceRecipe } from '../../../src/renderer/lib/recipeExecution';
import { resolveDestinationCapabilities } from '../../../src/renderer/lib/activeDestination';
import { RECIPES_DISABLED_MESSAGE } from '../../../src/shared/recipeAvailability';
import type { RecipeLaunchStep } from '../../../src/shared/types/recipes';

describe('recipes are parked without running launch instructions', () => {
  it.each<RecipeLaunchStep>([
    { id: 'shell', type: 'shell' },
    { id: 'agent', type: 'harness', harnessId: 'codex' },
    { id: 'command', type: 'command', command: 'npm run dev' },
  ])('blocks $type before any workspace, PTY, Browser or layout side effect', async (step) => {
    const deps = { ensureWorkspaceOpen: vi.fn(), spawnTerminal: vi.fn(), onTerminalSpawned: vi.fn(), openBrowserPreview: vi.fn(), restoreLayout: vi.fn(), probePreview: vi.fn() };
    const result = await executeWorkspaceRecipe({ id: 'saved', name: 'Saved', workspacePath: '/repo', launches: [step], browser: { url: 'http://localhost:5173' }, createdAt: 1, updatedAt: 1, version: 1 }, deps);
    expect(result).toMatchObject({ success: false, steps: [{ status: 'failed', error: RECIPES_DISABLED_MESSAGE }] });
    for (const callback of Object.values(deps)) expect(callback).not.toHaveBeenCalled();
  });
  it('hides the feature without disabling ordinary launches or history', () => {
    const capability = resolveDestinationCapabilities({ kind: 'workspace', workspaceId: 'w' });
    expect(capability.recipes).toBe(false);
    expect(capability.terminalLaunch).toBe(true); expect(capability.sessionHistory).toBe(true);
  });
});
