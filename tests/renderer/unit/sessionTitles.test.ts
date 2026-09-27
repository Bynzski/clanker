import { describe, expect, it } from 'vitest';
import type { HarnessSession } from '../../../src/shared/types/session';
import { getSessionDisplayTitles } from '../../../src/renderer/lib/sessionTitles';

const session = (id: string, title: string, timestamp: number): HarnessSession => ({
  id, title, timestamp, harness: 'codex', cwd: '/workspace',
});

describe('getSessionDisplayTitles', () => {
  it('keeps a unique title unchanged', () => {
    const titles = getSessionDisplayTitles([session('one', 'Fix terminal resize', 1000)]);
    expect(titles.get('codex\0one')).toBe('Fix terminal resize');
  });

  it('distinguishes repeated titles even within the same minute', () => {
    const sessions = [
      session('session-111111', 'Review the current code changes', Date.UTC(2026, 8, 27, 13, 38, 1)),
      session('session-222222', 'Review the current code changes', Date.UTC(2026, 8, 27, 13, 38, 2)),
    ];
    const titles = getSessionDisplayTitles(sessions);
    expect(titles.get('codex\0session-111111')).toContain('111111 · Review the current code changes');
    expect(titles.get('codex\0session-222222')).toContain('222222 · Review the current code changes');
  });
});
