import type {
  WorkspaceRecipe,
  PersistedRecipeLayout,
  RecipeLaunchResult,
  RecipeLaunchStepResult,
  RecipePreviewProbeResult,
} from '../../shared/types/recipes';

export interface RecipeExecutionDeps {
  ensureWorkspaceOpen: (workspacePath: string) => Promise<string | null>;
  spawnTerminal: (
    workingDir: string,
    harness?: string,
    model?: string,
    initialCommand?: string,
    recipeCommand?: boolean,
  ) => Promise<{ id: string; pid: number; harnessId?: string; attentionEnabled?: boolean }>;
  onTerminalSpawned: (
    workspaceId: string,
    terminal: { id: string; pid: number; workingDir: string; harnessId: string | null; attentionEnabled: boolean },
  ) => void;
  openBrowserPreview?: (workspaceId: string, url: string) => Promise<boolean>;
  restoreLayout?: (workspaceId: string, layout: PersistedRecipeLayout) => void;
  getExistingTerminalCount?: (workspaceId: string) => number;
  waitRecipeCommand?: (terminalId: string) => Promise<{ status: 'success' | 'started' | 'failed'; error?: string }>;
  probePreview?: (url: string, waitForReady: boolean) => Promise<RecipePreviewProbeResult>;
}

export async function executeWorkspaceRecipe(
  recipe: WorkspaceRecipe,
  deps: RecipeExecutionDeps,
): Promise<RecipeLaunchResult> {
  if (recipe.environmentId && recipe.environmentId !== 'local') {
    return {
      recipeId: recipe.id,
      success: false,
      steps: [{ id: 'remote-recipe', type: 'command', status: 'failed',
        error: 'Launch recipes are not supported for SSH workspaces in this version.' }],
    };
  }

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

  const existingCount = deps.getExistingTerminalCount?.(workspaceId) ?? 0;
  if (recipe.launches.length > 0 && existingCount > 0) {
    return {
      recipeId: recipe.id,
      success: false,
      steps: [{ id: 'workspace-occupied', type: 'shell', status: 'failed',
        error: 'This workspace already has active terminals. Close them or reopen the project before launching this recipe.' }],
    };
  }

  let previewBeforeLaunch: RecipePreviewProbeResult | undefined;
  if (recipe.browser?.url && deps.probePreview) {
    try {
      previewBeforeLaunch = await deps.probePreview(recipe.browser.url, false);
    } catch (err) {
      previewBeforeLaunch = { status: 'invalid', error: err instanceof Error ? err.message : String(err) };
    }
    if (previewBeforeLaunch.status === 'invalid') {
      return { recipeId: recipe.id, success: false,
        steps: [{ id: 'browser', type: 'browser', status: 'failed', error: previewBeforeLaunch.error }] };
    }
    if (previewBeforeLaunch.status === 'ready' && recipe.launches.some((step) => step.type === 'command')) {
      return { recipeId: recipe.id, success: false,
        steps: [{ id: 'browser', type: 'browser', status: 'failed',
          error: `Port ${previewBeforeLaunch.port} is already in use on ${previewBeforeLaunch.host}` }] };
    }
  }

  if (recipe.launches.length === 0) {
    const targetCount = Math.max(1, recipe.terminalCount ?? 1);
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
            : await deps.spawnTerminal(recipe.workspacePath, undefined, undefined, step.command, true);
          deps.onTerminalSpawned(workspaceId, {
            id: info.id,
            pid: info.pid,
            workingDir: recipe.workspacePath,
            harnessId: null,
            attentionEnabled: false,
          });
          let commandOutcome: { status: 'success' | 'started' | 'failed'; error?: string } = { status: 'success' };
          if (step.type === 'command') {
            try {
              commandOutcome = await deps.waitRecipeCommand?.(info.id) ?? { status: 'started' };
            } catch (err) {
              commandOutcome = { status: 'failed', error: err instanceof Error ? err.message : String(err) };
            }
          }
          steps.push({
            id: step.id,
            type: step.type,
            status: commandOutcome.status,
            ...(commandOutcome.error ? { error: commandOutcome.error } : {}),
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

  if (recipe.layout && deps.restoreLayout) {
    try {
      deps.restoreLayout(workspaceId, recipe.layout);
    } catch {
      // Incompatible layout restoration falls back gracefully
    }
  }

  if (recipe.browser?.url && deps.openBrowserPreview) {
    try {
      let previewFailure: string | undefined;
      if (deps.probePreview && previewBeforeLaunch?.status === 'unavailable') {
        const readiness = await deps.probePreview(recipe.browser.url, true);
        if (readiness.status !== 'ready' && readiness.status !== 'remote') {
          previewFailure = readiness.status === 'invalid' ? readiness.error
            : `Preview did not become available on ${readiness.host}:${readiness.port}`;
        }
      }
      if (previewFailure) {
        steps.push({ id: 'browser', type: 'browser', status: 'failed', error: previewFailure });
      } else {
        const ok = await deps.openBrowserPreview(workspaceId, recipe.browser.url);
        steps.push(ok
          ? { id: 'browser', type: 'browser', status: 'success' }
          : { id: 'browser', type: 'browser', status: 'failed',
            error: `Failed to open browser preview at ${recipe.browser.url}` });
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
  const success = steps.every((s) => s.status !== 'failed');

  return {
    recipeId: recipe.id,
    success,
    steps,
  };
}
