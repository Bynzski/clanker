import type {
  WorkspaceRecipe,
  PersistedRecipeLayout,
  RecipeLaunchResult,
  RecipeLaunchStepResult,
} from '../../shared/types/recipes';

export interface RecipeExecutionDeps {
  ensureWorkspaceOpen: (workspacePath: string) => Promise<string | null>;
  spawnTerminal: (
    workingDir: string,
    harness?: string,
    model?: string,
    initialCommand?: string,
  ) => Promise<{ id: string; pid: number; harnessId?: string; attentionEnabled?: boolean }>;
  onTerminalSpawned: (
    workspaceId: string,
    terminal: { id: string; pid: number; workingDir: string; harnessId: string | null; attentionEnabled: boolean },
  ) => void;
  openBrowserPreview?: (workspaceId: string, url: string) => Promise<boolean>;
  restoreLayout?: (workspaceId: string, layout: PersistedRecipeLayout) => void;
  getExistingTerminalCount?: (workspaceId: string) => number;
}

export async function executeWorkspaceRecipe(
  recipe: WorkspaceRecipe,
  deps: RecipeExecutionDeps,
): Promise<RecipeLaunchResult> {
  const steps: RecipeLaunchStepResult[] = [];

  const workspaceId = await deps.ensureWorkspaceOpen(recipe.workspacePath);
  if (!workspaceId) {
    return {
      recipeId: recipe.id,
      success: false,
      steps: [
        {
          id: 'workspace-open',
          type: 'command',
          status: 'failed',
          error: `Could not open workspace at ${recipe.workspacePath}`,
        },
      ],
    };
  }

  if (recipe.launches.length === 0) {
    const targetCount = Math.max(1, recipe.terminalCount ?? 1);
    const existingCount = deps.getExistingTerminalCount?.(workspaceId) ?? 0;
    for (let index = existingCount; index < targetCount; index++) {
      try {
        const info = await deps.spawnTerminal(recipe.workspacePath);
        deps.onTerminalSpawned(workspaceId, {
          id: info.id,
          pid: info.pid,
          workingDir: recipe.workspacePath,
          harnessId: null,
          attentionEnabled: false,
        });
        steps.push({
          id: `terminal-${index + 1}`,
          type: 'shell',
          status: 'success',
          terminalId: info.id,
        });
      } catch (err) {
        steps.push({
          id: `terminal-${index + 1}`,
          type: 'shell',
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } else {
    for (const step of recipe.launches) {
      if (step.type === 'harness') {
        try {
          const info = await deps.spawnTerminal(recipe.workspacePath, step.harnessId, step.modelId);
          deps.onTerminalSpawned(workspaceId, {
            id: info.id,
            pid: info.pid,
            workingDir: recipe.workspacePath,
            harnessId: info.harnessId ?? step.harnessId,
            attentionEnabled: info.attentionEnabled === true,
          });
          steps.push({
            id: step.id,
            type: 'harness',
            status: 'success',
            terminalId: info.id,
          });
        } catch (err) {
          steps.push({
            id: step.id,
            type: 'harness',
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } else if (step.type === 'shell' || step.type === 'command') {
        try {
          const info = step.type === 'shell'
            ? await deps.spawnTerminal(recipe.workspacePath)
            : await deps.spawnTerminal(recipe.workspacePath, undefined, undefined, step.command);
          deps.onTerminalSpawned(workspaceId, {
            id: info.id,
            pid: info.pid,
            workingDir: recipe.workspacePath,
            harnessId: null,
            attentionEnabled: false,
          });
          steps.push({
            id: step.id,
            type: step.type,
            status: 'success',
            terminalId: info.id,
          });
        } catch (err) {
          steps.push({
            id: step.id,
            type: step.type,
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  if (recipe.browser?.url && deps.openBrowserPreview) {
    try {
      const ok = await deps.openBrowserPreview(workspaceId, recipe.browser.url);
      if (ok) {
        steps.push({
          id: 'browser',
          type: 'browser',
          status: 'success',
        });
      } else {
        steps.push({
          id: 'browser',
          type: 'browser',
          status: 'failed',
          error: `Failed to open browser preview at ${recipe.browser.url}`,
        });
      }
    } catch (err) {
      steps.push({
        id: 'browser',
        type: 'browser',
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (recipe.layout && deps.restoreLayout) {
    try {
      deps.restoreLayout(workspaceId, recipe.layout);
    } catch {
      // Incompatible layout restoration falls back gracefully
    }
  }

  const success = steps.length > 0 ? steps.every((s) => s.status === 'success') : true;

  return {
    recipeId: recipe.id,
    success,
    steps,
  };
}
