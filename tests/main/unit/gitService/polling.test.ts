/**
 * Git Service - Polling Real Behavior Tests
 * 
 * Tests for the polling functionality (startPolling, stopPolling, refresh, getCurrentWorkspace)
 * using real git repositories.
 * 
 * These tests verify the observable behavior of the polling system without mocking git commands.
 * The key behaviors tested are:
 * - Initial status emission when polling starts
 * - Timer management (start/stop/restart)
 * - State transitions
 * - Refresh behavior
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitService } from '../../../../src/main/gitService';
import type { GitStatusResult } from '../../../../src/main/gitService';
import {
  createTempGitRepo,
  modifyFile,
  git,
} from '../../../../tests/setup/gitTestHelpers';

interface TempRepo {
  path: string;
  cleanup: () => void;
}

// ============================================================================
// Test Setup
// ============================================================================

let repo: TempRepo | null = null;
let emittedStatuses: GitStatusResult[] = [];
let service: GitService;

function resetService() {
  emittedStatuses = [];
  service = new GitService((status) => {
    emittedStatuses.push(status);
  });
}

async function waitForStatusEmission(expectedCount = 1, timeoutMs = 1000): Promise<void> {
  const start = Date.now();

  while (emittedStatuses.length < expectedCount && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  if (emittedStatuses.length < expectedCount) {
    throw new Error(`Expected ${expectedCount} status emission(s), received ${emittedStatuses.length}`);
  }
}

beforeEach(() => {
  resetService();
});

afterEach(() => {
  if (repo) {
    repo.cleanup();
    repo = null;
  }
  service.stopPolling();
});

// ============================================================================
// startPolling - Happy Path Tests
// ============================================================================

describe('startPolling - happy path with real git', () => {
  it('emits initial status when polling starts', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    service.startPolling(repo.path);

    await waitForStatusEmission();

    expect(emittedStatuses.length).toBeGreaterThanOrEqual(1);
    expect(emittedStatuses[0].success).toBe(true);
    expect(emittedStatuses[0].isRepo).toBe(true);
  });

  it('sets current workspace to the repo path', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    service.startPolling(repo.path);

    expect(service.getCurrentWorkspace()).toBe(repo.path);
  });

  it('emits status with correct branch information', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    // First verify the repo works correctly
    const directStatus = await service.getStatus(repo.path);
    expect(directStatus.success).toBe(true);
    expect(directStatus.currentBranch).toBeTruthy();

    // Reset to ensure clean state
    emittedStatuses = [];
    
    // Now test polling
    service.startPolling(repo.path);
    
    await waitForStatusEmission();

    expect(emittedStatuses.length).toBeGreaterThanOrEqual(1);
    const status = emittedStatuses[0];
    
    // Verify the status is valid
    expect(status.success).toBe(true);
    expect(status.isRepo).toBe(true);
    expect(typeof status.currentBranch === 'string' || status.currentBranch === null).toBe(true);
  });

  it('handles repository with changes', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    // Add a modification
    await modifyFile(repo.path, 'file.ts', 'modified content');
    await git(repo.path, ['add', 'file.ts']);

    service.startPolling(repo.path);
    await waitForStatusEmission();

    expect(emittedStatuses[0].success).toBe(true);
    expect(emittedStatuses[0].changes.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// startPolling - Edge Cases
// ============================================================================

describe('startPolling - edge cases with real git', () => {
  it('handles non-existent path gracefully', async () => {
    const nonExistent = path.join(os.tmpdir(), 'non-existent-' + Date.now());

    // Should not throw
    service.startPolling(nonExistent);
    await waitForStatusEmission();

    expect(service.getCurrentWorkspace()).toBe(nonExistent);
    // Status should indicate failure
    expect(emittedStatuses[0].success).toBe(false);
  });

  it('handles empty directory gracefully', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'));

    try {
      service.startPolling(emptyDir);
      await waitForStatusEmission();

      expect(service.getCurrentWorkspace()).toBe(emptyDir);
      expect(emittedStatuses[0].success).toBe(false);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('handles repository without commits', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
      initialCommit: false,
    });

    service.startPolling(repo.path);
    await waitForStatusEmission();

    expect(emittedStatuses[0].success).toBe(true);
    expect(emittedStatuses[0].isRepo).toBe(true);
  });
});

// ============================================================================
// stopPolling - Tests
// ============================================================================

describe('stopPolling - with real git', () => {
  it('clears current workspace when stopped', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    service.startPolling(repo.path);
    await new Promise((r) => setTimeout(r, 50));
    service.stopPolling();

    expect(service.getCurrentWorkspace()).toBeNull();
  });

  it('can restart polling after stopping', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    service.startPolling(repo.path);
    await waitForStatusEmission();
    const initialStatusCount = emittedStatuses.length;

    service.stopPolling();
    await new Promise((r) => setTimeout(r, 50));

    // Start polling with same repo again
    service.startPolling(repo.path);
    await waitForStatusEmission(initialStatusCount + 1);

    expect(service.getCurrentWorkspace()).toBe(repo.path);
    expect(emittedStatuses.length).toBeGreaterThan(initialStatusCount);
  });

  it('stops polling on repeated startPolling calls', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    // Start with first path
    service.startPolling(repo.path + '-first');
    await new Promise((r) => setTimeout(r, 50));

    // Start again with second path
    service.startPolling(repo.path + '-second');
    await new Promise((r) => setTimeout(r, 50));

    // Only the second path should be tracked
    expect(service.getCurrentWorkspace()).toBe(repo.path + '-second');
  });
});

// ============================================================================
// refresh - Tests
// ============================================================================

describe('refresh - with real git', () => {
  it('returns current status when polling is active', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    service.startPolling(repo.path);
    await new Promise((r) => setTimeout(r, 50));

    const result = await service.refresh();

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.isRepo).toBe(true);
  });

  it('returns null when not polling', async () => {
    const result = await service.refresh();

    expect(result).toBeNull();
  });

  it('returns null after stopping polling', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    service.startPolling(repo.path);
    await new Promise((r) => setTimeout(r, 50));
    service.stopPolling();

    const result = await service.refresh();

    expect(result).toBeNull();
  });

  it('reflects changes made after polling started', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    service.startPolling(repo.path);
    await new Promise((r) => setTimeout(r, 50));

    // Make a change
    await modifyFile(repo.path, 'file.ts', 'new content');
    await git(repo.path, ['add', 'file.ts']);

    const result = await service.refresh();

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    // The change should be visible
    expect(result!.changes.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// getCurrentWorkspace - Tests
// ============================================================================

describe('getCurrentWorkspace - with real git', () => {
  it('returns null initially', () => {
    expect(service.getCurrentWorkspace()).toBeNull();
  });

  it('returns the workspace path when polling', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    service.startPolling(repo.path);
    await new Promise((r) => setTimeout(r, 50));

    expect(service.getCurrentWorkspace()).toBe(repo.path);
  });

  it('returns null after stopping', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    service.startPolling(repo.path);
    await new Promise((r) => setTimeout(r, 50));
    service.stopPolling();

    expect(service.getCurrentWorkspace()).toBeNull();
  });

  it('returns the latest workspace when restarted', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    const repo2 = await createTempGitRepo({
      initialFiles: { 'file2.ts': 'content' },
    });

    service.startPolling(repo.path);
    await new Promise((r) => setTimeout(r, 50));
    service.startPolling(repo2.path);
    await new Promise((r) => setTimeout(r, 50));

    expect(service.getCurrentWorkspace()).toBe(repo2.path);

    // Cleanup repo2
    repo2.cleanup();
  });
});

// ============================================================================
// Polling Lifecycle - Integration Tests
// ============================================================================

describe('polling lifecycle - integration with real git', () => {
  it('emits status updates on polling interval', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    // Reduce poll interval for testing
    (service as unknown as { pollIntervalMs: number }).pollIntervalMs = 100;

    service.startPolling(repo.path);
    await waitForStatusEmission();

    const countAfterInitial = emittedStatuses.length;

    await waitForStatusEmission(countAfterInitial + 1);

    expect(emittedStatuses.length).toBeGreaterThan(countAfterInitial);

    // Restore default
    (service as unknown as { pollIntervalMs: number }).pollIntervalMs = 30000;
  });

  it('handles rapid start/stop cycles', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    // Rapid cycling
    for (let i = 0; i < 5; i++) {
      service.startPolling(repo.path);
      await new Promise((r) => setTimeout(r, 10));
      service.stopPolling();
    }

    expect(service.getCurrentWorkspace()).toBeNull();
  });

  it('tracks different workspaces correctly', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    const repo2 = await createTempGitRepo({
      initialFiles: { 'other.ts': 'content' },
    });

    // Add pending changes to both repos
    await modifyFile(repo.path, 'file.ts', 'modified');
    await modifyFile(repo2.path, 'other.ts', 'modified');

    // Start polling first repo
    service.startPolling(repo.path);
    await new Promise((r) => setTimeout(r, 100));

    const firstRepoStatus = await service.refresh();
    expect(firstRepoStatus!.changes.some(c => c.path === 'file.ts')).toBe(true);

    // Switch to second repo
    service.startPolling(repo2.path);
    await new Promise((r) => setTimeout(r, 100));

    const secondRepoStatus = await service.refresh();
    expect(secondRepoStatus!.changes.some(c => c.path === 'other.ts')).toBe(true);

    // Cleanup
    repo2.cleanup();
  });

  it('handles detached HEAD state during polling', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    // Create a second commit and checkout detached
    await git(repo.path, ['commit', '--allow-empty', '-m', 'Second commit']);
    const result = await git(repo.path, ['rev-parse', 'HEAD']);
    await git(repo.path, ['checkout', result.stdout.trim()]);

    service.startPolling(repo.path);
    await waitForStatusEmission();

    expect(emittedStatuses[0].isDetached).toBe(true);
    expect(emittedStatuses[0].currentBranch).toBeNull();
  });
});
