import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rendererRoot = resolve(__dirname, '../../../src/renderer');
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const rules = (css: string) => [...withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)];

const cssFiles = readdirSync(rendererRoot, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.css'))
  .map((entry) => resolve(entry.parentPath, entry.name));

/**
 * Legitimate pill / circular affordances:
 * - 50% / 100% for status dots, activity pulses, and circular indicators.
 * - 999px / 9999px for full-pill badges, counters, and splitter grips.
 */
const isPillOrCircle = (value: string) =>
  /^(?:50%|100%|999px|9999px)$/i.test(value.trim());

/**
 * Standard token usage: var(--radius-*) or multi-value token compositions (e.g. var(--radius-sm) var(--radius-sm) 0 0).
 * Also accepts fallback variables such as var(--radius-md, 8px).
 */
const isTokenizedRadius = (value: string) => {
  // Normalize internal whitespace inside var(...) so fallback values don't split
  const normalized = value.trim().replace(/var\(([^)]+)\)/g, (_, inner) => `var(${inner.replace(/\s+/g, '')})`);
  const parts = normalized.split(/\s+/);
  return parts.every(
    (part) =>
      part === '0' ||
      /^var\(--radius-(?:sm|md|lg)(?:,[^)]+)?\)$/.test(part) ||
      part === 'inherit' ||
      part === 'initial' ||
      part === 'unset',
  );
};

/**
 * Documented Class E intentional exceptions:
 * Affordances with intentional, non-standard visual geometry.
 */
const INTENTIONAL_EXCEPTIONS: Record<string, string[]> = {
  // Browser tab uses trapezoidal curved top corners
  'components/BrowserPanel.css': ['.browser-tab', '.browser-pane-drag-handle'],
  // Drag handle dot grid texture uses 3px radial gradient dot bounds
  'components/DynamicPaneLayout.css': [
    '.terminal-drag-handle',
    '.browser-pane-drag-handle',
    '.pane-dock-zone span',
  ],
  'components/EditorPane.css': ['.editor-pane-drag-handle'],
  'components/NotesPane.css': ['.notes-pane-drag-handle'],
  'components/FileExplorer/FileExplorer.css': ['.file-explorer-drag-handle'],
  // OS-native scrollbar thumb styling
  'styles/global.css': ['::-webkit-scrollbar-thumb'],
  'components/EditorTabBar.css': ['.editor-tab-bar::-webkit-scrollbar-thumb'],
  // Intentional pill counters / status chips with fixed compact height
  'components/ChatHistoryDropdown.css': ['.chat-history-harness-count', '.chat-history-count'],
  'components/CommitDialog.css': ['.commit-file-status'],
  'components/GitButton.css': ['.git-ahead-badge', '.git-badge'],
  'components/git/GitRemotesSection.css': [
    '.git-remotes-count',
    '.git-remotes-tag',
    '.git-remotes-suggestion',
  ],
  'components/git/ProviderBadge.css': [
    '.provider-badge',
    '.provider-badge-tag',
    '.pr-state',
    '.review-state',
  ],
  'components/RecipeModal.css': ['.recipe-badge'],
  // Workspace tabs use rounded top corners only (tab silhouette)
  'components/WorkspaceTabs.css': ['.workspace-tab'],
  'components/WorkspaceGate.css': [
    '.gate-directory-badge',
    '.gate-recipe-chip-count',
  ],
};


function matchesAnySelector(ruleSelector: string, allowedSelectors: string[]) {
  const ruleParts = ruleSelector.split(',').map((s) => s.trim());
  return allowedSelectors.some((allowed) =>
    ruleParts.some((sel) => sel.includes(allowed) || allowed.includes(sel)),
  );
}

describe('Clanker Geometry & Design System Contract', () => {
  it('defines the canonical radius tokens in global.css :root', () => {
    const globalCss = readFileSync(resolve(rendererRoot, 'styles/global.css'), 'utf8');
    const rootRule = rules(globalCss).find((r) => r[1].trim() === ':root');
    expect(rootRule).toBeDefined();
    const body = rootRule![2];

    expect(body).toMatch(/--radius-sm:\s*2px;/);
    expect(body).toMatch(/--radius-md:\s*4px;/);
    expect(body).toMatch(/--radius-lg:\s*8px;/);
  });

  it('strictly enforces tokenized geometry on all shared UI primitives (components/ui/*.css)', () => {
    const uiDir = resolve(rendererRoot, 'components/ui');
    const uiCssFiles = readdirSync(uiDir)
      .filter((file) => file.endsWith('.css'))
      .map((file) => resolve(uiDir, file));

    for (const file of uiCssFiles) {
      const content = readFileSync(file, 'utf8');
      for (const rule of rules(content)) {
        const selector = rule[1].trim();
        for (const match of rule[2].matchAll(/\bborder(?:-[a-z]+)*-radius\s*:\s*([^;]+);/g)) {
          const val = match[1].trim();
          const valid = isTokenizedRadius(val) || isPillOrCircle(val);
          expect(
            valid,
            `Violation in shared UI primitive ${file} at "${selector}": radius "${val}" must use var(--radius-*) or pill/circle.`,
          ).toBe(true);
        }
      }
    }
  });

  it('ensures core shared primitives default to --radius-sm', () => {
    const checks: [file: string, selectorSubstring: string][] = [
      ['components/ui/Button.css', '.clanker-button'],
      ['components/ui/Dialog.css', '.clanker-dialog-content'],
      ['components/ui/Popover.css', '.clanker-popover-content'],
      ['components/ui/SegmentedControl.css', '.clanker-segmented-control'],
      ['components/ui/SegmentedControl.css', '.clanker-segmented-item'],
      ['components/ui/SearchablePicker.css', '.searchable-picker-row'],
      ['components/ui/Input.css', '.clanker-input'],
    ];

    for (const [fileRel, selectorPart] of checks) {
      const filePath = resolve(rendererRoot, fileRel);
      const content = readFileSync(filePath, 'utf8');
      const matchingRule = rules(content).find((r) => r[1].includes(selectorPart));
      expect(matchingRule, `Expected rule matching "${selectorPart}" in ${fileRel}`).toBeDefined();
      expect(
        matchingRule![2],
        `Rule for "${selectorPart}" in ${fileRel} must use var(--radius-sm)`,
      ).toMatch(/border-radius\s*:\s*var\(--radius-sm\)/);
    }
  });

  it('prevents untracked arbitrary numeric radii across all renderer CSS', () => {
    const violations: string[] = [];

    for (const file of cssFiles) {
      const relPath = relative(rendererRoot, file).replace(/\\/g, '/');
      const content = readFileSync(file, 'utf8');

      const fileExceptions = INTENTIONAL_EXCEPTIONS[relPath] ?? [];

      for (const rule of rules(content)) {
        const selector = rule[1].trim();
        for (const match of rule[2].matchAll(/\bborder(?:-[a-z]+)*-radius\s*:\s*([^;]+);/g)) {
          const val = match[1].trim();

          // 1. Valid token or standard pill/circle?
          if (isTokenizedRadius(val) || isPillOrCircle(val)) {
            continue;
          }

          // 2. Documented intentional Class E exception?
          if (matchesAnySelector(selector, fileExceptions)) {
            continue;
          }

          // Otherwise: untracked arbitrary radius literal!
          violations.push(
            `\n[GEOMETRY VIOLATION] ${relPath} -> ${selector}\n` +
              `  Found raw radius: "${val}"\n` +
              `  Clanker geometry rule: Rectangular controls must use var(--radius-sm) (2px).\n` +
              `  Pills/circles may use 50% or 999px. See src/renderer/components/ui/README.md.`,
          );
        }
      }
    }

    expect(
      violations,
      violations.length > 0 ? `Found ${violations.length} geometry violation(s):\n${violations.join('\n')}` : '',
    ).toEqual([]);
  });

  it('correctly catches arbitrary radius literals with an instructive violation message', () => {
    const mockCss = `
      .my-feature-card {
        border-radius: 7px;
      }
    `;
    const mockViolations: string[] = [];
    for (const rule of rules(mockCss)) {
      const selector = rule[1].trim();
      for (const match of rule[2].matchAll(/\bborder(?:-[a-z]+)*-radius\s*:\s*([^;]+);/g)) {
        const val = match[1].trim();
        if (!isTokenizedRadius(val) && !isPillOrCircle(val)) {
          mockViolations.push(`[GEOMETRY VIOLATION] components/Feature.css -> ${selector}: "${val}"`);
        }
      }
    }
    expect(mockViolations).toHaveLength(1);
    expect(mockViolations[0]).toContain('.my-feature-card: "7px"');
  });
});
