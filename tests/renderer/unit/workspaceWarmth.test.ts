import { describe, expect, it } from 'vitest';
import {
  MAX_WARM_WORKSPACE_SURFACES,
  recordWorkspaceActivation,
  selectWarmWorkspaceIds,
} from '../../../src/renderer/lib/workspaceWarmth';

describe('workspace warmth policy', () => {
  it('keeps the active workspace and most recently active workspaces warm', () => {
    expect(selectWarmWorkspaceIds(
      ['ws-1', 'ws-2', 'ws-3', 'ws-4'],
      'ws-1',
      ['ws-4', 'ws-3', 'ws-2'],
    )).toEqual(['ws-1', 'ws-4', 'ws-3']);
  });

  it('fills a restored session deterministically from newest to oldest', () => {
    expect(selectWarmWorkspaceIds(
      ['ws-1', 'ws-2', 'ws-3', 'ws-4'],
      'ws-4',
      [],
    )).toEqual(['ws-4', 'ws-3', 'ws-2']);
  });

  it('always includes the active workspace even with a zero cap', () => {
    expect(selectWarmWorkspaceIds(['ws-1', 'ws-2'], 'ws-1', [], 0)).toEqual(['ws-1']);
  });

  it('records activation order and removes closed workspaces', () => {
    expect(recordWorkspaceActivation(
      ['ws-3', 'closed', 'ws-1'],
      'ws-2',
      ['ws-1', 'ws-2', 'ws-3'],
    )).toEqual(['ws-2', 'ws-3', 'ws-1']);
  });

  it('defaults to a three-surface cap', () => {
    expect(MAX_WARM_WORKSPACE_SURFACES).toBe(3);
  });
});
