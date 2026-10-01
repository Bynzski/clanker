import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
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
  'components/TaskRecoverySection.css': [
    '.task-recovery-badge',
    '.task-recovery-count',
    '.task-recovery-status',
    '.task-recovery-state-badge',
  ],
  'components/WorkspaceGate.css': [
    '.gate-directory-badge',
    '.gate-recipe-chip-count',
  ],
  'components/WorkspaceTabs.css': ['.workspace-tab-attention'],
};

/**
 * Legacy feature-owned styling backlog from Issue #64 audit.
 * As stages 2-5 migrate components to shared primitives, entries are removed from here.
 */
const STAGED_MIGRATION_BACKLOG: Record<string, string[]> = {
  'App.css': ['.main-content-loading', '.workspace-error-fallback button'],
  'components/BrowserPanel.css': [
    '.browser-nav-btn',
    '.browser-tab-close',
    '.browser-url-input',
    '.browser-url-suggestions',
    '.browser-url-suggestion-item',
    '.browser-history-suggestions',
    '.browser-history-suggestion',
    '.browser-go-btn',
    '.browser-annotate-btn',
    '.remote-preview-controls input',
    '.remote-preview-controls button',
  ],
  'components/DynamicPaneLayout.css': ['.drag-ghost', '.pane-drag-preview'],
  'components/EditorPane.css': [
    '.editor-btn',
    '.editor-pane button',
    '.editor-fallback-close',
    '.editor-pane-lock-btn',
    '.editor-pane-close-btn',
    '.editor-reload-banner-btn',
  ],
  'components/EditorTabBar.css': ['.editor-tabs', '.editor-tab-close'],
  'components/ErrorBoundary.css': ['.error-boundary button', '.error-boundary-retry'],
  'components/git/GitRemotesSection.css': [
    '.git-remotes-add-btn',
    '.git-remotes-cancel-btn',
    '.git-remotes-add-dashed',
    '.git-remotes-empty-add-btn',
    '.git-remote-item',
    '.git-remote-action-btn',
    '.git-remotes-item',
    '.git-remotes-item-btn',
    '.git-remotes-form',
    '.git-remotes-input',
    '.git-remotes-input-row input',
    '.git-remotes-form-error',
    '.git-remotes-error',
    '.git-remotes-submit-btn',
    '.git-remotes-form-actions button',
  ],
  'components/git/ProviderMenu.css': [
    '.provider-menu-trigger',
    '.provider-menu-dropdown',
    '.provider-menu-content',
    '.provider-menu-refresh',
    '.provider-menu-link',
    '.provider-menu-item',
    '.provider-menu-quick-action',
  ],
  'components/Header.css': [
    '.harness-pill',
    '.harness-defaults-favorite-tag',
    '.harness-defaults-add-fav',
  ],
  'components/NotesPane.css': ['.notes-btn', '.notes-pane-close-btn'],
  'components/TaskRecoverySection.css': [
    '.task-recovery-card',
    '.task-action-btn',
    '.task-recovery-fork-btn',
    '.task-session-picker',
    '.task-session-picker-item',
    '.task-recovery-item',
    '.task-recovery-item button',
    '.task-recovery-error',
  ],
  'components/TerminalPane.css': ['.terminal-pane-close', '.terminal-action'],
  'components/WorkspaceGate.css': [
    '.gate-worktree-base',
    '.gate-worktree-branch',
    '.gate-worktree-confirm',
    '.gate-worktree-back',
    '.gate-worktrees button',
    '.gate-worktrees input',
    '.gate-history-item',
    '.grid-option',
    '.suggestion-item',
    '.favorites-browse-link',
    '.gate-model-item',
    '.gate-model-manage',
    '.discovery-item',
    '.discovery-clear-search',
    '.discovery-close',
    '.discovery-star-btn',
    '.favorites-item',
    '.favorites-star',
  ],
  'components/WorkspaceTabs.css': [
    '.workspace-tab-close',
    '.workspace-tab-edit-trigger',
    '.workspace-tab-edit-input',
    '.workspace-tab-edit-btn',
  ],
  'components/FileExplorer/FileExplorer.css': ['.tree-node-input'],
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
      const relPath = file.replace(rendererRoot + '/', '');
      const content = readFileSync(file, 'utf8');

      const fileExceptions = INTENTIONAL_EXCEPTIONS[relPath] ?? [];
      const fileBacklog = STAGED_MIGRATION_BACKLOG[relPath] ?? [];

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

          // 3. Staged migration backlog item?
          if (matchesAnySelector(selector, fileBacklog)) {
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
