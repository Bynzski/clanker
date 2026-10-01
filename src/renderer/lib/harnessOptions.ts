import { createElement } from 'react';
import type { ElementType } from 'react';
import type { HarnessDefaultsMap } from '../../shared/types/store';
import codexLogoUrl from '../assets/harness-logos/codex.svg';
import claudeLogoUrl from '../assets/harness-logos/claude.svg';
import opencodeLogoUrl from '../assets/harness-logos/opencode.svg';
import piLogoUrl from '../assets/harness-logos/pi.svg';
import ompLogoUrl from '../assets/harness-logos/omp.svg';
import hermesLogoUrl from '../assets/harness-logos/hermes.svg';
import agyLogoUrl from '../assets/harness-logos/agy.svg';
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

function createHarnessLogoIcon(src: string, monochrome = false): ElementType<HarnessIconProps> {
  return function HarnessLogoIcon({ size = 16, className }: HarnessIconProps) {
    const classes = ['harness-logo-icon', monochrome && 'harness-logo-monochrome', className].filter(Boolean).join(' ');

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

// Harness logos are SVG image URLs supplied by Vite.
const HARNESS_SVG_ICONS = {
  codex: createHarnessLogoIcon(codexLogoUrl, true),
  claude: createHarnessLogoIcon(claudeLogoUrl),
  opencode: createHarnessLogoIcon(opencodeLogoUrl, true),
  pi: createHarnessLogoIcon(piLogoUrl, true),
  omp: createHarnessLogoIcon(ompLogoUrl, true),
  hermes: createHarnessLogoIcon(hermesLogoUrl, true),
  agy: createHarnessLogoIcon(agyLogoUrl, true),
} as const;

export const HARNESS_OPTIONS: HarnessOption[] = [
  { id: '', label: 'Terminal', Icon: Terminal },
  { id: 'codex', label: 'Codex', Icon: HARNESS_SVG_ICONS.codex },
  { id: 'claude', label: 'Claude', Icon: HARNESS_SVG_ICONS.claude },
  { id: 'opencode', label: 'OpenCode', Icon: HARNESS_SVG_ICONS.opencode },
  { id: 'pi', label: 'Pi', Icon: HARNESS_SVG_ICONS.pi },
  { id: 'omp', label: 'Oh My Pi', Icon: HARNESS_SVG_ICONS.omp },
  { id: 'hermes', label: 'Hermes', Icon: HARNESS_SVG_ICONS.hermes },
  { id: 'agy', label: 'Antigravity', Icon: HARNESS_SVG_ICONS.agy },
];

export const AI_COMMIT_PROVIDER_IDS = ['codex', 'opencode', 'pi', 'omp', 'agy'] as const;

export function resolveAvailableHarnessIds(
  options: Record<string, unknown>,
  includeTerminal: boolean = true
): string[] {
  return HARNESS_OPTIONS
    .map((option) => option.id)
    .filter((id) => (includeTerminal && id === '') || Boolean(options[id]));
}

export function isHarnessVisible(defaults: HarnessDefaultsMap | null | undefined, harnessId: string): boolean {
  if (harnessId === '') {
    return true;
  }

  return defaults?.[harnessId]?.visible !== false;
}

export function resolveVisibleHarnessIds(
  availableHarnessIds: string[],
  defaults: HarnessDefaultsMap | null | undefined
): string[] {
  return availableHarnessIds.filter((id) => isHarnessVisible(defaults, id));
}
