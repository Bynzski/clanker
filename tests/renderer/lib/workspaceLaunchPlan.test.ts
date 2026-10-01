import { describe, expect, it } from 'vitest';
import { recipeTerminalCounts, MAX_GATE_TERMINALS } from '../../../src/renderer/lib/workspaceLaunchPlan';
import type { WorkspaceRecipe } from '../../../src/shared/types/recipes';

const recipe: WorkspaceRecipe = {
  id: 'preset', name: 'Preset', version: 1, workspacePath: '/repo', createdAt: 0, updatedAt: 0,
  launches: [{ id: 'ai', type: 'harness', harnessId: 'codex' }, { id: 'command', type: 'command', command: 'echo hello' }],
};

describe('recipe count presets', () => {
  it('pads additional panes with ordinary terminals and treats commands as count entries', () => {
    expect(recipeTerminalCounts({ ...recipe, terminalCount: 4 }, ['', 'codex'])).toEqual({ codex: 1, '': 3 });
  });
  it('rejects unavailable harnesses rather than replacing them', () => {
    expect(() => recipeTerminalCounts(recipe, [''])).toThrow('unavailable harness: codex');
  });
  it('rejects oversized presets rather than truncating them', () => {
    expect(() => recipeTerminalCounts({ ...recipe, terminalCount: MAX_GATE_TERMINALS + 1 }, ['', 'codex'])).toThrow('at most 16');
  });
});
