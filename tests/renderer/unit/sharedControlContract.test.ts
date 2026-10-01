import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Known feature fields must leave the standard contract to ui/Input.css.
 * This allows native semantic controls and product geometry; it is not a tag ban.
 */
const fields = [
  ['BrowserPanel.css', 'browser-url-input'],
  ['git/GitRemotesSection.css', 'git-remotes-input'],
  ['Header.css', 'settings-select'],
  ['NotesPane.css', 'notes-editor'],
  ['FileExplorer/FileExplorer.css', 'tree-node-input'],
  ['WorkspaceTabs.css', 'workspace-tab-edit-input'],
] as const;

describe('shared feature field contract', () => {
  it.each(fields)('%s leaves %s appearance and states to the shared primitive', (file, className) => {
    const css = readFileSync(resolve(__dirname, '../../../src/renderer/components', file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!new RegExp(`\\.${className}(?![\\w-])`).test(selector)) continue;
      const declarations = [...body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)];
      for (const [, property, value] of declarations) {
        // Notes is a borderless full-pane editor; its focus ring remains shared.
        if (className === 'notes-editor' && property === 'border' && value.trim() === '0') continue;
        expect(property, `${file}: ${selector.trim()}`).not.toMatch(
          /^(?:background(?:-.+)?|border(?:-.+)?|color|font(?:-.+)?|outline(?:-.+)?|box-shadow|transition|opacity|cursor)$/,
        );
      }
    }
  });
});
