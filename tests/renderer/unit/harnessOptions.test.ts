import { describe, it, expect } from 'vitest';
import {
  HARNESS_OPTIONS,
  AI_COMMIT_PROVIDER_IDS,
  resolveAvailableHarnessIds,
} from '../../../src/renderer/lib/harnessOptions';

describe('HARNESS_OPTIONS', () => {
  it('contains expected harness ids', () => {
    const ids = HARNESS_OPTIONS.map(o => o.id);
    expect(ids).toContain('');
    expect(ids).toContain('codex');
    expect(ids).toContain('claude');
    expect(ids).toContain('opencode');
    expect(ids).toContain('pi');
  });

  it('each option has label and Icon', () => {
    for (const option of HARNESS_OPTIONS) {
      expect(option.label).toBeTruthy();
      expect(option.Icon).toBeTruthy();
    }
  });
});

describe('AI_COMMIT_PROVIDER_IDS', () => {
  it('includes codex, opencode, and pi', () => {
    expect(AI_COMMIT_PROVIDER_IDS).toContain('codex');
    expect(AI_COMMIT_PROVIDER_IDS).toContain('opencode');
    expect(AI_COMMIT_PROVIDER_IDS).toContain('pi');
  });

  it('does not include empty string (terminal-only)', () => {
    expect(AI_COMMIT_PROVIDER_IDS).not.toContain('');
  });

  it('does not include claude', () => {
    expect(AI_COMMIT_PROVIDER_IDS).not.toContain('claude');
  });
});

describe('resolveAvailableHarnessIds', () => {
  it('returns all harness ids when all options are enabled and includeTerminal is true', () => {
    const options = { codex: true, claude: true, opencode: true, pi: true };
    const result = resolveAvailableHarnessIds(options, true);
    expect(result).toEqual(['', 'codex', 'claude', 'opencode', 'pi']);
  });

  it('excludes terminal when includeTerminal is false', () => {
    const options = { codex: true, claude: true, opencode: true, pi: true };
    const result = resolveAvailableHarnessIds(options, false);
    expect(result).not.toContain('');
    expect(result).toEqual(['codex', 'claude', 'opencode', 'pi']);
  });

  it('only includes enabled options', () => {
    const options = { codex: true, claude: false, opencode: false, pi: false };
    const result = resolveAvailableHarnessIds(options, true);
    expect(result).toEqual(['', 'codex']);
  });

  it('returns only terminal when no other options are enabled', () => {
    const options = { codex: false, claude: false, opencode: false, pi: false };
    const result = resolveAvailableHarnessIds(options, true);
    expect(result).toEqual(['']);
  });

  it('returns empty array when nothing is enabled and includeTerminal is false', () => {
    const options = { codex: false, claude: false, opencode: false, pi: false };
    const result = resolveAvailableHarnessIds(options, false);
    expect(result).toEqual([]);
  });

  it('uses falsy checks for option values', () => {
    const options = { codex: 0, claude: '', opencode: null, pi: undefined };
    const result = resolveAvailableHarnessIds(options as unknown as Record<string, unknown>, false);
    expect(result).toEqual([]);
  });
});
