import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../../src/renderer/components');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');

describe('shared attention presentation ownership', () => {
  it('defines the shared styles in their own stylesheet, imported by the shared indicators module', () => {
    const css = read('AgentAttentionIndicators.css');
    expect(css).toContain('.agent-attention-state');
    expect(css).toContain('.workspace-attention-badge');
    expect(read('AgentAttentionIndicators.tsx')).toContain("import './AgentAttentionIndicators.css'");
  });

  it('does not leave attention styles in TerminalPane or WorkspaceTabs stylesheets', () => {
    expect(read('TerminalPane.css')).not.toMatch(/agent-attention-state|terminal-agent-state/);
    expect(read('WorkspaceTabs.css')).not.toMatch(/attention/);
  });

  it('all three surfaces consume the shared indicators; the sidebar names no foreign classes', () => {
    for (const file of ['TerminalPane.tsx', 'WorkspaceTabs.tsx', 'WorkspaceNavigatorSection.tsx']) {
      expect(read(file), file).toContain("from './AgentAttentionIndicators'");
    }
    expect(read('WorkspaceNavigatorSection.tsx')).not.toMatch(/terminal-agent-state|workspace-tab-attention/);
  });
});
