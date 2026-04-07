import { Brain, Pi, Sparkles, Terminal, Zap, type LucideIcon } from 'lucide-react';

export interface HarnessOption {
  id: string;
  label: string;
  Icon: LucideIcon;
}

export const HARNESS_OPTIONS: HarnessOption[] = [
  { id: '', label: 'Terminal', Icon: Terminal },
  { id: 'codex', label: 'Codex', Icon: Brain },
  { id: 'claude', label: 'Claude', Icon: Sparkles },
  { id: 'opencode', label: 'OpenCode', Icon: Zap },
  { id: 'pi', label: 'Pi', Icon: Pi },
];

export const AI_COMMIT_PROVIDER_IDS = ['codex', 'opencode', 'pi'] as const;

export function resolveAvailableHarnessIds(
  options: Record<string, unknown>,
  includeTerminal: boolean = true
): string[] {
  return HARNESS_OPTIONS
    .map((option) => option.id)
    .filter((id) => (includeTerminal && id === '') || Boolean(options[id]));
}
