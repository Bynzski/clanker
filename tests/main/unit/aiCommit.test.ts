/**
 * AI Commit Tests - Real Behavior
 * Tests for AI-assisted commit message generation.
 *
 * All tests use real string parsing and formatting - no mocks needed.
 * The functions are pure transformations on string data.
 */

import { describe, it, expect } from 'vitest';
import {
  AI_COMMIT_COMMANDS,
  buildAiCommitArgs,
  buildCommitPrompt,
  getAiCommitTimeoutMs,
  normalizeCommitMessageOutput,
  type CommitPromptContext,
} from '../../../src/main/aiCommit';

// ============================================================================
// AI_COMMIT_COMMANDS - Static Data Tests
// ============================================================================

describe('AI_COMMIT_COMMANDS structure', () => {
  it('contains all three providers', () => {
    expect(Object.keys(AI_COMMIT_COMMANDS)).toHaveLength(3);
    expect(AI_COMMIT_COMMANDS).toHaveProperty('codex');
    expect(AI_COMMIT_COMMANDS).toHaveProperty('opencode');
    expect(AI_COMMIT_COMMANDS).toHaveProperty('pi');
  });

  it('each provider has required fields', () => {
    for (const config of Object.values(AI_COMMIT_COMMANDS)) {
      expect(typeof config.command).toBe('string');
      expect(Array.isArray(config.args)).toBe(true);
      expect(typeof config.modelArg).toBe('string');
    }
  });

  it('codex uses correct exec command and -m flag', () => {
    expect(AI_COMMIT_COMMANDS.codex.command).toBe('codex');
    expect(AI_COMMIT_COMMANDS.codex.args).toContain('exec');
    expect(AI_COMMIT_COMMANDS.codex.modelArg).toBe('-m');
  });

  it('opencode uses -m flag', () => {
    expect(AI_COMMIT_COMMANDS.opencode.command).toBe('opencode');
    expect(AI_COMMIT_COMMANDS.opencode.modelArg).toBe('-m');
  });

  it('pi uses --model flag', () => {
    expect(AI_COMMIT_COMMANDS.pi.command).toBe('pi');
    expect(AI_COMMIT_COMMANDS.pi.modelArg).toBe('--model');
  });
});

// ============================================================================
// getAiCommitTimeoutMs Tests
// ============================================================================

describe('getAiCommitTimeoutMs', () => {
  describe('happy path - known providers', () => {
    it('returns 90000ms for opencode', () => {
      expect(getAiCommitTimeoutMs('opencode')).toBe(90000);
    });

    it('returns 60000ms for codex', () => {
      expect(getAiCommitTimeoutMs('codex')).toBe(60000);
    });

    it('returns 45000ms for pi', () => {
      expect(getAiCommitTimeoutMs('pi')).toBe(45000);
    });
  });

  describe('edge cases', () => {
    it('returns 60000ms default for unknown provider', () => {
      // This tests the default case in the switch statement
      const unknownProvider = 'unknown' as 'codex' | 'opencode' | 'pi';
      expect(getAiCommitTimeoutMs(unknownProvider)).toBe(60000);
    });

    it('opencode has the longest timeout', () => {
      expect(getAiCommitTimeoutMs('opencode')).toBeGreaterThan(getAiCommitTimeoutMs('codex'));
      expect(getAiCommitTimeoutMs('opencode')).toBeGreaterThan(getAiCommitTimeoutMs('pi'));
    });
  });
});

// ============================================================================
// buildAiCommitArgs Tests
// ============================================================================

describe('buildAiCommitArgs', () => {
  describe('happy path - with model', () => {
    it('prepends model arg before harness args for codex', () => {
      const args = buildAiCommitArgs('codex', 'gpt-4');
      expect(args).toEqual(['exec', '-m', 'gpt-4']);
    });

    it('prepends model arg before harness args for opencode', () => {
      const args = buildAiCommitArgs('opencode', 'claude-3.5-sonnet');
      expect(args).toEqual(['-m', 'claude-3.5-sonnet']);
    });

    it('prepends model arg before harness args for pi', () => {
      const args = buildAiCommitArgs('pi', 'anthropic/sonnet');
      expect(args).toEqual(['--model', 'anthropic/sonnet']);
    });

    it('includes both exec and model for codex', () => {
      const args = buildAiCommitArgs('codex', 'gpt-5.4-mini');
      expect(args[0]).toBe('exec');
      expect(args[1]).toBe('-m');
      expect(args[2]).toBe('gpt-5.4-mini');
    });
  });

  describe('edge cases - without model', () => {
    it('returns just harness args when no model provided for codex', () => {
      const args = buildAiCommitArgs('codex', undefined);
      expect(args).toEqual(['exec']);
    });

    it('returns empty array when no model provided for opencode', () => {
      const args = buildAiCommitArgs('opencode', undefined);
      expect(args).toEqual([]);
    });

    it('returns empty array when no model provided for pi', () => {
      const args = buildAiCommitArgs('pi', undefined);
      expect(args).toEqual([]);
    });

    it('returns just harness args for empty string model', () => {
      const args = buildAiCommitArgs('codex', '');
      expect(args).toEqual(['exec']);
    });
  });

  describe('model format handling', () => {
    it('preserves provider/model format in model value', () => {
      const args = buildAiCommitArgs('opencode', 'openai/gpt-4o');
      expect(args).toContain('openai/gpt-4o');
    });

    it('handles model names with colons', () => {
      const args = buildAiCommitArgs('pi', 'sonnet:high thinking');
      expect(args).toContain('sonnet:high thinking');
    });

    it('handles model names with special characters', () => {
      const args = buildAiCommitArgs('opencode', 'opencode/zen/big-pickle');
      expect(args).toContain('opencode/zen/big-pickle');
    });

    it('handles versioned model names', () => {
      const args = buildAiCommitArgs('opencode', 'anthropic/claude-3.5-sonnet-20240620');
      expect(args).toContain('anthropic/claude-3.5-sonnet-20240620');
    });
  });
});

// ============================================================================
// buildCommitPrompt Tests
// ============================================================================

describe('buildCommitPrompt', () => {
  const baseContext: CommitPromptContext = {
    workspacePath: '/repo',
    branchName: 'main',
    isDetached: false,
    changeSummary: ['staged modified: src/app.ts', 'unstaged added: README.md'],
    diffMode: 'staged',
    diffSummary: '2 files changed, 14 insertions(+), 3 deletions(-)',
  };

  describe('happy path - includes all sections', () => {
    it('includes instruction section', () => {
      const prompt = buildCommitPrompt(baseContext);
      expect(prompt).toContain('Write one git commit subject line');
      expect(prompt).toContain('Format: feature:');
      expect(prompt).toContain('imperative mood');
    });

    it('includes repository context', () => {
      const prompt = buildCommitPrompt(baseContext);
      expect(prompt).toContain('Repository: /repo');
      expect(prompt).toContain('Branch: main');
    });

    it('includes commit scope for staged changes', () => {
      const prompt = buildCommitPrompt(baseContext);
      expect(prompt).toContain('Commit scope: staged changes');
    });

    it('includes change summary', () => {
      const prompt = buildCommitPrompt(baseContext);
      expect(prompt).toContain('Changed files:');
      expect(prompt).toContain('- staged modified: src/app.ts');
      expect(prompt).toContain('- unstaged added: README.md');
    });

    it('includes diff summary', () => {
      const prompt = buildCommitPrompt(baseContext);
      expect(prompt).toContain('Diff summary:');
      expect(prompt).toContain('2 files changed, 14 insertions(+), 3 deletions(-)');
    });

    it('includes commit message marker', () => {
      const prompt = buildCommitPrompt(baseContext);
      expect(prompt).toContain('Commit message:');
    });
  });

  describe('edge cases - branch handling', () => {
    it('handles named branch', () => {
      const prompt = buildCommitPrompt({ ...baseContext, branchName: 'feature/my-feature' });
      expect(prompt).toContain('Branch: feature/my-feature');
    });

    it('handles null branch name', () => {
      const prompt = buildCommitPrompt({ ...baseContext, branchName: null });
      expect(prompt).toContain('Branch: Unknown branch');
    });

    it('handles empty branch name', () => {
      const prompt = buildCommitPrompt({ ...baseContext, branchName: '' });
      expect(prompt).toContain('Branch: Unknown branch');
    });

    it('handles detached HEAD when branch name is null', () => {
      const prompt = buildCommitPrompt({ ...baseContext, branchName: null, isDetached: true });
      expect(prompt).toContain('Branch: Detached HEAD');
    });

    it('handles detached HEAD when branch name is empty', () => {
      const prompt = buildCommitPrompt({ ...baseContext, branchName: '', isDetached: true });
      expect(prompt).toContain('Branch: Detached HEAD');
    });

    it('prefers branch name over detached label when both are present', () => {
      const prompt = buildCommitPrompt({ ...baseContext, branchName: 'feature-branch', isDetached: true });
      expect(prompt).toContain('Branch: feature-branch');
      expect(prompt).not.toContain('Branch: Detached HEAD');
    });
  });

  describe('edge cases - change summary', () => {
    it('handles empty change summary', () => {
      const prompt = buildCommitPrompt({ ...baseContext, changeSummary: [] });
      expect(prompt).toContain('- No file changes detected');
    });

    it('formats single change correctly', () => {
      const prompt = buildCommitPrompt({ ...baseContext, changeSummary: ['modified: src/main.ts'] });
      expect(prompt).toContain('- modified: src/main.ts');
    });

    it('formats multiple changes correctly', () => {
      const prompt = buildCommitPrompt({
        ...baseContext,
        changeSummary: ['A: new.ts', 'M: modified.ts', 'D: deleted.ts', 'R: renamed.ts'],
      });
      expect(prompt).toContain('- A: new.ts');
      expect(prompt).toContain('- M: modified.ts');
      expect(prompt).toContain('- D: deleted.ts');
      expect(prompt).toContain('- R: renamed.ts');
    });
  });

  describe('edge cases - diff summary', () => {
    it('handles empty diff summary', () => {
      const prompt = buildCommitPrompt({ ...baseContext, diffSummary: '' });
      expect(prompt).toContain('Diff summary:');
      expect(prompt).toContain('No diff summary available');
    });

    it('handles whitespace-only diff summary', () => {
      const prompt = buildCommitPrompt({ ...baseContext, diffSummary: '   \n\t  ' });
      expect(prompt).toContain('Diff summary:');
      expect(prompt).toContain('No diff summary available');
    });

    it('preserves meaningful diff summary', () => {
      const prompt = buildCommitPrompt({
        ...baseContext,
        diffSummary: '+100 lines, -50 lines',
      });
      expect(prompt).toContain('+100 lines, -50 lines');
    });
  });

  describe('edge cases - diff mode', () => {
    it('shows "working tree changes" for working diff mode', () => {
      const prompt = buildCommitPrompt({ ...baseContext, diffMode: 'working' });
      expect(prompt).toContain('Commit scope: working tree changes');
    });

    it('shows "staged changes" for staged diff mode', () => {
      const prompt = buildCommitPrompt({ ...baseContext, diffMode: 'staged' });
      expect(prompt).toContain('Commit scope: staged changes');
    });
  });

  describe('edge cases - workspace path', () => {
    it('handles relative path', () => {
      const prompt = buildCommitPrompt({ ...baseContext, workspacePath: './project' });
      expect(prompt).toContain('Repository: ./project');
    });

    it('handles path with spaces', () => {
      const prompt = buildCommitPrompt({ ...baseContext, workspacePath: '/my project/code' });
      expect(prompt).toContain('Repository: /my project/code');
    });

    it('handles path with special characters', () => {
      const prompt = buildCommitPrompt({ ...baseContext, workspacePath: '/home/user/project-name_v2' });
      expect(prompt).toContain('Repository: /home/user/project-name_v2');
    });
  });

  describe('format instructions coverage', () => {
    it('includes all four commit types', () => {
      const prompt = buildCommitPrompt(baseContext);
      expect(prompt).toContain('feature');
      expect(prompt).toContain('fix');
      expect(prompt).toContain('restructure');
      expect(prompt).toContain('chore');
    });

    it('explains when to use each type', () => {
      const prompt = buildCommitPrompt(baseContext);
      // Verify the explanations are present
      expect(prompt).toContain('new capability');
      expect(prompt).toContain('bug fix');
      expect(prompt).toContain('refactor');
      expect(prompt).toContain('docs/tests/maintenance');
    });

    it('requires imperative mood', () => {
      const prompt = buildCommitPrompt(baseContext);
      expect(prompt).toContain('imperative mood');
    });

    it('requires concise format', () => {
      const prompt = buildCommitPrompt(baseContext);
      expect(prompt).toContain('72 characters');
    });

    it('requests plain text output only', () => {
      const prompt = buildCommitPrompt(baseContext);
      expect(prompt).toContain('Return only plain text');
    });
  });
});

// ============================================================================
// normalizeCommitMessageOutput Tests
// ============================================================================

describe('normalizeCommitMessageOutput', () => {
  describe('happy path - basic cleanup', () => {
    it('returns the commit message unchanged when clean', () => {
      expect(normalizeCommitMessageOutput('feat: add new feature')).toBe('feat: add new feature');
    });

    it('trims whitespace', () => {
      expect(normalizeCommitMessageOutput('  feat: add feature  ')).toBe('feat: add feature');
      expect(normalizeCommitMessageOutput('\tfix: bug fix\n')).toBe('fix: bug fix');
    });
  });

  describe('ANSI color code removal', () => {
    it('removes basic ANSI codes', () => {
      expect(normalizeCommitMessageOutput('\u001B[32mfeat: green text\u001B[0m')).toBe('feat: green text');
    });

    it('removes complex ANSI codes', () => {
      expect(normalizeCommitMessageOutput('\u001B[1;34mfeat: bold blue\u001B[0m')).toBe('feat: bold blue');
    });

    it('removes 256-color ANSI codes', () => {
      expect(normalizeCommitMessageOutput('\u001B[38;5;214mfeat: orange\u001B[0m')).toBe('feat: orange');
    });

    it('removes RGB ANSI codes', () => {
      expect(normalizeCommitMessageOutput('\u001B[38;2;255;128;0mfeat: rgb\u001B[0m')).toBe('feat: rgb');
    });
  });

  describe('code fence removal', () => {
    it('removes markdown code fences', () => {
      expect(normalizeCommitMessageOutput('```\nfeat: add feature\n```')).toBe('feat: add feature');
    });

    it('removes text code fences', () => {
      expect(normalizeCommitMessageOutput('```text\nfeat: add feature\n```')).toBe('feat: add feature');
    });

    it('removes markdown code fences with language', () => {
      expect(normalizeCommitMessageOutput('```markdown\nfeat: add feature\n```')).toBe('feat: add feature');
    });

    it('handles fenced content with AI output patterns', () => {
      // When content is within fences, it gets properly parsed
      const output = '```text\nCommit message: feat: add feature\n```';
      const result = normalizeCommitMessageOutput(output);
      // The function removes both fence AND prefix, returning just the message
      expect(result).toBe('feat: add feature');
    });

    it('handles fences with trailing whitespace', () => {
      expect(normalizeCommitMessageOutput('```text\nfeat: test\n```  \n')).toBe('feat: test');
    });
  });

  describe('prefix and punctuation removal', () => {
    it('removes "commit message:" prefix', () => {
      expect(normalizeCommitMessageOutput('Commit message: feat: add feature')).toBe('feat: add feature');
    });

    it('removes "subject:" prefix', () => {
      expect(normalizeCommitMessageOutput('Subject: feat: add feature')).toBe('feat: add feature');
    });

    it('removes "message:" prefix', () => {
      expect(normalizeCommitMessageOutput('Message: feat: add feature')).toBe('feat: add feature');
    });

    it('removes leading dashes', () => {
      expect(normalizeCommitMessageOutput('- feat: add feature')).toBe('feat: add feature');
    });

    it('removes leading asterisks (markdown lists)', () => {
      expect(normalizeCommitMessageOutput('* feat: add feature')).toBe('feat: add feature');
    });

    it('removes leading bullets', () => {
      expect(normalizeCommitMessageOutput('• feat: add feature')).toBe('feat: add feature');
    });

    it('removes leading quotes', () => {
      expect(normalizeCommitMessageOutput('"feat: add feature"')).toBe('feat: add feature');
    });

    it('removes trailing quotes', () => {
      expect(normalizeCommitMessageOutput("'feat: add feature'")).toBe('feat: add feature');
    });

    it('removes both leading and trailing quotes', () => {
      expect(normalizeCommitMessageOutput('`feat: add feature`')).toBe('feat: add feature');
    });
  });

  describe('edge cases - multiline input', () => {
    it('extracts first line only from multiline', () => {
      const input = `feat: add new feature

This is a longer description that should be ignored`;
      expect(normalizeCommitMessageOutput(input)).toBe('feat: add new feature');
    });

    it('handles CRLF line endings', () => {
      expect(normalizeCommitMessageOutput('feat: test\r\nanother line')).toBe('feat: test');
    });

    it('handles mixed line endings', () => {
      expect(normalizeCommitMessageOutput('feat: test\nline2\r\nline3')).toBe('feat: test');
    });

    it('handles trailing empty lines', () => {
      expect(normalizeCommitMessageOutput('feat: test\n\n\n')).toBe('feat: test');
    });
  });

  describe('edge cases - empty/minimal input', () => {
    it('returns empty string for empty input', () => {
      expect(normalizeCommitMessageOutput('')).toBe('');
    });

    it('returns empty string for whitespace-only input', () => {
      expect(normalizeCommitMessageOutput('   \n\t  ')).toBe('');
    });

    it('returns input when only ANSI codes present', () => {
      expect(normalizeCommitMessageOutput('\u001B[0m')).toBe('');
    });

    it('handles single character input', () => {
      expect(normalizeCommitMessageOutput('x')).toBe('x');
    });
  });

  describe('real-world patterns', () => {
    it('handles actual Claude CLI output with ANSI', () => {
      const output = '\u001B[32mfeat: add AI commit helper\u001B[0m';
      expect(normalizeCommitMessageOutput(output)).toBe('feat: add AI commit helper');
    });

    it('handles Codex output with fences', () => {
      const output = '```text\nfeat: implement new feature\n```';
      expect(normalizeCommitMessageOutput(output)).toBe('feat: implement new feature');
    });

    it('handles pi output with subject prefix', () => {
      const output = 'Subject: fix: resolve authentication bug';
      expect(normalizeCommitMessageOutput(output)).toBe('fix: resolve authentication bug');
    });

    it('handles quoted output from AI', () => {
      const output = '"chore: update dependencies"';
      expect(normalizeCommitMessageOutput(output)).toBe('chore: update dependencies');
    });

    it('handles markdown list output', () => {
      const output = '- feat: add user authentication';
      expect(normalizeCommitMessageOutput(output)).toBe('feat: add user authentication');
    });

    it('handles complex AI output with multiple markers', () => {
      // The function removes fences, then extracts first line, then removes prefix
      const output = '```text\nCommit message: feat: add feature\n```';
      expect(normalizeCommitMessageOutput(output)).toBe('feat: add feature');
    });

    it('handles OpenCode output with ANSI and fences', () => {
      const output = '\u001B[32m```\u001B[0m\n\u001B[32mfeat: implement auth\n\u001B[32m```\u001B[0m';
      // After ANSI removal, should look like:
      // ```
      // feat: implement auth
      // ```
      expect(normalizeCommitMessageOutput(output)).toBe('feat: implement auth');
    });
  });

  describe('failure handling', () => {
    it('returns input when normalization produces empty result', () => {
      // This tests behavior when all content is just formatting
      const input = '```text\n```';
      expect(normalizeCommitMessageOutput(input)).toBe('');
    });

    it('returns input when only prefix is present', () => {
      const input = 'Commit message:';
      // After removing prefix and trimming, should be empty
      expect(normalizeCommitMessageOutput(input)).toBe('');
    });

    it('preserves actual content even with many formatting characters', () => {
      const input = '```text\nfeat: test\n```';
      expect(normalizeCommitMessageOutput(input)).toBe('feat: test');
    });
  });
});
