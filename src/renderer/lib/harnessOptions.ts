import { createElement } from 'react';
import type { ElementType } from 'react';
import codexLogoUrl from '../assets/harness-logos/codex.svg';
import claudeLogoUrl from '../assets/harness-logos/claude.svg';
import opencodeLogoUrl from '../assets/harness-logos/opencode.svg';
import piLogoUrl from '../assets/harness-logos/pi.svg';
import { Terminal } from 'lucide-react';

export interface HarnessIconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export interface HarnessOption {
  id: string;
  label: string;
  Icon: ElementType<HarnessIconProps>;
}

function createHarnessLogoIcon(src: string): ElementType<HarnessIconProps> {
  return function HarnessLogoIcon({ size = 16, className }: HarnessIconProps) {
    const classes = ['harness-logo-icon', className].filter(Boolean).join(' ');

    return createElement('img', {
      src,
      alt: '',
      'aria-hidden': true,
      className: classes,
      width: size,
      height: size,
    });
  };
}

// Custom SVG logos from svgl.app, rendered as image URLs under Vite.
const HARNESS_SVG_ICONS = {
  codex: createHarnessLogoIcon(codexLogoUrl),
  claude: createHarnessLogoIcon(claudeLogoUrl),
  opencode: createHarnessLogoIcon(opencodeLogoUrl),
  pi: createHarnessLogoIcon(piLogoUrl),
} as const;

export const HARNESS_OPTIONS: HarnessOption[] = [
  { id: '', label: 'Terminal', Icon: Terminal },
  { id: 'codex', label: 'Codex', Icon: HARNESS_SVG_ICONS.codex },
  { id: 'claude', label: 'Claude', Icon: HARNESS_SVG_ICONS.claude },
  { id: 'opencode', label: 'OpenCode', Icon: HARNESS_SVG_ICONS.opencode },
  { id: 'pi', label: 'Pi', Icon: HARNESS_SVG_ICONS.pi },
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
