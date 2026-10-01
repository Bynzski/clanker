import type { WorkspaceRecipe } from '../../shared/types/recipes';

export interface WorkspaceTerminalLaunch {
  harness: string;
  model?: string;
}

// Bound one launch gesture without changing the running workspace's pane limits.
export const MAX_GATE_TERMINALS = 16;

export function recipeTerminalCounts(recipe: WorkspaceRecipe, availableIds: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const step of recipe.launches) {
    const harness = step.type === 'harness' ? step.harnessId : '';
    if (!availableIds.includes(harness)) throw new Error(`This recipe needs an unavailable harness: ${harness}.`);
    counts[harness] = (counts[harness] ?? 0) + 1;
  }
  const total = Math.max(recipe.launches.length, recipe.terminalCount ?? 0, 1);
  if (total > MAX_GATE_TERMINALS) throw new Error(`Choose a recipe with at most ${MAX_GATE_TERMINALS} terminals.`);
  counts[''] = (counts[''] ?? 0) + total - recipe.launches.length;
  return counts;
}
