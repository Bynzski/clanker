import type { RecipeLaunchStep } from '../../shared/types/recipes';

export function captureTerminalLaunches(terminals: readonly { harnessId?: string | null }[]): RecipeLaunchStep[] {
  return terminals.map((terminal, index) => terminal.harnessId
    ? { id: `step-${index + 1}`, type: 'harness', harnessId: terminal.harnessId }
    : { id: `step-${index + 1}`, type: 'shell' });
}
