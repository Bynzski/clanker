import { describe, expect, it } from 'vitest';
import { sessionCheckoutLabel } from '../../src/renderer/components/ChatHistoryDropdown';

const base = { id: 'a', harness: 'claude' as const, title: 't', cwd: '/p', timestamp: 1 };

describe('sessionCheckoutLabel', () => {
  it('is empty for ordinary sessions', () => expect(sessionCheckoutLabel(base)).toBeNull());
  it('shows the branch of a live worktree', () =>
    expect(sessionCheckoutLabel({ ...base, checkout: { branch: 'feat', path: '/p-wt/feat', exists: true } })).toBe('feat'));
  it('marks a removed worktree and falls back to its directory name', () =>
    expect(sessionCheckoutLabel({ ...base, checkout: { branch: null, path: '/p-wt/old-9', exists: false } })).toBe('old-9 · removed'));
});
