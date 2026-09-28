export type RecipeLaunchStepType = 'shell' | 'command' | 'harness';

export interface RecipeShellStep {
  id: string;
  type: 'shell';
  title?: string;
}

export interface RecipeCommandStep {
  id: string;
  type: 'command';
  command: string;
  title?: string;
}

export interface RecipeHarnessStep {
  id: string;
  type: 'harness';
  harnessId: string;
  modelId?: string;
  title?: string;
}

export type RecipeLaunchStep = RecipeShellStep | RecipeCommandStep | RecipeHarnessStep;

export interface PersistedRecipeLayout {
  root: unknown;
  terminalCount: number;
  explorerVisible?: boolean;
}

export interface WorkspaceRecipe {
  id: string;
  name: string;
  workspacePath: string;
  description?: string;
  terminalCount?: number;
  launches: RecipeLaunchStep[];
  browser?: {
    url: string;
  };
  layout?: PersistedRecipeLayout;
  createdAt: number;
  updatedAt: number;
  version: 1;
}

export interface RecipeLaunchStepResult {
  id: string;
  type: 'shell' | 'command' | 'harness' | 'browser';
  status: 'success' | 'failed';
  error?: string;
  terminalId?: string;
}

export interface RecipeLaunchResult {
  recipeId: string;
  success: boolean;
  steps: RecipeLaunchStepResult[];
}
