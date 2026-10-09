/**
 * VCS IPC Handlers Tests
 *
 * Tests for the VCS IPC module. Verifies that all VCS handlers
 * are properly registered and delegate correctly to the VCS service.
 */

import { vi, describe, test, expect, beforeEach } from 'vitest';
import type { ProviderContextResult, DeepLink } from '../../../src/main/vcs/types';

// Mock electron module
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

// Mock the VCS module
vi.mock('../../../src/main/vcs', () => ({
  getProviderContext: vi.fn<() => Promise<ProviderContextResult>>(),
  getProviderDeepLinks: vi.fn<() => DeepLink[]>(),
  getDeepLinkUrl: vi.fn<() => string | null>(),
  getProviderPrLink: vi.fn<() => Promise<string | null>>(),
}));

// Mock the aiCommitIpc module for getValidatedWorkspacePath
vi.mock('../../../src/main/ipc/aiCommitIpc', () => ({
  getValidatedWorkspacePath: vi.fn<(path: string) => string | null>(),
}));

// Mock GitService
const mockGitService = {
  getBranchState: vi.fn(),
  getRemotes: vi.fn(),
  withWorkspace: vi.fn((_identity: unknown, operation: () => unknown) => operation()),
};

vi.mock('../../../src/main/gitService', () => ({
  GitService: vi.fn(() => mockGitService),
}));

// Import after mocking
import { ipcMain, shell } from 'electron';
import {
  getProviderContext,
  getProviderDeepLinks,
  getDeepLinkUrl,
  getProviderPrLink,
} from '../../../src/main/vcs';

import { getValidatedWorkspacePath } from '../../../src/main/ipc/aiCommitIpc';
import { registerVcsIpc } from '../../../src/main/ipc/vcsIpc';
import { GitService } from '../../../src/main/gitService';

describe('registerVcsIpc', () => {
  const mockIpcMain = ipcMain as typeof ipcMain & {
    handle: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('registers all VCS IPC channels', () => {
    const expectedChannels = [
      'vcs:get-context',
      'vcs:get-pr-info',
      'vcs:get-deep-links',
      'vcs:get-deep-link',
      'vcs:open-deep-link',
    ];

    registerVcsIpc({
      getGitService: () => mockGitService as unknown as GitService,
    });

    expect(mockIpcMain.handle).toHaveBeenCalledTimes(expectedChannels.length);
    expectedChannels.forEach((channel) => {
      expect(mockIpcMain.handle).toHaveBeenCalledWith(channel, expect.any(Function));
    });
  });

  test('vcs:get-context returns error for invalid workspace', async () => {
    vi.mocked(getValidatedWorkspacePath).mockReturnValue(null);

    registerVcsIpc({
      getGitService: () => mockGitService as unknown as GitService,
    });
    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'vcs:get-context'
    )?.[1] as (_: unknown, workspacePath: string) => unknown;
    const result = await handler(null, '/invalid/path');

    expect(result).toEqual({
      success: false,
      error: 'Invalid workspace path',
    });
  });

  test('vcs:get-context returns error when not a git repo', async () => {
    vi.mocked(getValidatedWorkspacePath).mockReturnValue('/valid/path');
    vi.mocked(mockGitService.getBranchState).mockResolvedValue({
      success: false,
      isRepo: false,
      currentBranch: null,
      isDetached: false,
      branches: [],
    });
    vi.mocked(mockGitService.getRemotes).mockResolvedValue({
      success: false,
      remotes: [],
      provider: 'unknown',
    });

    registerVcsIpc({
      getGitService: () => mockGitService as unknown as GitService,
    });
    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'vcs:get-context'
    )?.[1] as (_: unknown, workspacePath: string) => unknown;
    const result = await handler(null, '/valid/path');

    expect(result).toEqual({
      success: false,
      error: 'Not a git repository or no remotes configured',
    });
  });

  test('vcs:get-context returns context for valid workspace', async () => {
    const mockContext: ProviderContextResult = {
      success: true,
    };
    vi.mocked(getValidatedWorkspacePath).mockReturnValue('/valid/path');
    vi.mocked(mockGitService.getBranchState).mockResolvedValue({
      success: true,
      isRepo: true,
      currentBranch: 'main',
      isDetached: false,
      branches: [],
    });
    vi.mocked(mockGitService.getRemotes).mockResolvedValue({
      success: true,
      remotes: [{ name: 'origin', fetchUrl: 'https://github.com/user/repo.git' }],
      provider: 'github',
    });
    vi.mocked(getProviderContext).mockResolvedValue(mockContext);

    registerVcsIpc({
      getGitService: () => mockGitService as unknown as GitService,
    });
    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'vcs:get-context'
    )?.[1] as (_: unknown, workspacePath: string) => Promise<ProviderContextResult>;
    const result = await handler(null, '/valid/path');

    expect(getProviderContext).toHaveBeenCalledWith(
      'origin',
      'https://github.com/user/repo.git',
      'main'
    );
    expect(result).toEqual(mockContext);
  });

  test('vcs:get-pr-info returns error for invalid workspace', async () => {
    vi.mocked(getValidatedWorkspacePath).mockReturnValue(null);

    registerVcsIpc({
      getGitService: () => mockGitService as unknown as GitService,
    });
    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'vcs:get-pr-info'
    )?.[1] as (_: unknown, workspacePath: string) => unknown;
    const result = await handler(null, '/invalid/path');

    expect(result).toEqual({ success: false, error: 'Invalid workspace path' });
  });

  test('vcs:get-deep-links returns empty array for invalid workspace', async () => {
    vi.mocked(getValidatedWorkspacePath).mockReturnValue(null);

    registerVcsIpc({
      getGitService: () => mockGitService as unknown as GitService,
    });
    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'vcs:get-deep-links'
    )?.[1] as (_: unknown, workspacePath: string, prNumber?: number) => DeepLink[];
    const result = await handler(null, '/invalid/path');

    expect(result).toEqual([]);
  });

  test('vcs:get-deep-links returns deep links for valid workspace', async () => {
    const mockDeepLinks: DeepLink[] = [
      { type: 'repo', url: 'https://github.com/user/repo', label: 'Repository' },
      { type: 'pr', url: 'https://github.com/user/repo/pull/1', label: 'PR #1' },
    ];
    vi.mocked(getValidatedWorkspacePath).mockReturnValue('/valid/path');
    vi.mocked(mockGitService.getBranchState).mockResolvedValue({
      success: true,
      isRepo: true,
      currentBranch: 'feature-branch',
      isDetached: false,
      branches: [],
    });
    vi.mocked(mockGitService.getRemotes).mockResolvedValue({
      success: true,
      remotes: [{ name: 'origin', fetchUrl: 'https://github.com/user/repo.git' }],
      provider: 'github',
    });
    vi.mocked(getProviderDeepLinks).mockReturnValue(mockDeepLinks);

    registerVcsIpc({
      getGitService: () => mockGitService as unknown as GitService,
    });
    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'vcs:get-deep-links'
    )?.[1] as (_: unknown, workspacePath: string, prNumber?: number) => DeepLink[];
    const result = await handler(null, '/valid/path', 1);

    expect(getProviderDeepLinks).toHaveBeenCalledWith('https://github.com/user/repo.git', 'feature-branch', 1);
    expect(getProviderContext).not.toHaveBeenCalled();
    expect(getProviderPrLink).not.toHaveBeenCalled();
    expect(result).toEqual(mockDeepLinks);
  });

  test('vcs:get-deep-link returns null for invalid workspace', async () => {
    vi.mocked(getValidatedWorkspacePath).mockReturnValue(null);

    registerVcsIpc({
      getGitService: () => mockGitService as unknown as GitService,
    });
    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'vcs:get-deep-link'
    )?.[1] as (_: unknown, workspacePath: string, type: DeepLink['type']) => string | null;
    const result = await handler(null, '/invalid/path', 'repo');

    expect(result).toBeNull();
  });

  test('vcs:open-deep-link returns false for invalid workspace', async () => {
    vi.mocked(getValidatedWorkspacePath).mockReturnValue(null);

    registerVcsIpc({
      getGitService: () => mockGitService as unknown as GitService,
    });
    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'vcs:open-deep-link'
    )?.[1] as (_: unknown, workspacePath: string, type: DeepLink['type']) => boolean;
    const result = await handler(null, '/invalid/path', 'repo');

    expect(result).toBe(false);
  });
  test.each(['repo', 'branches', 'issues', 'releases', 'actions', 'create-pr'] as const)(
    'static %s link and open requests never fetch provider context', async (type) => {
      vi.mocked(getValidatedWorkspacePath).mockReturnValue('/valid/path');
      mockGitService.getBranchState.mockResolvedValue({ success: true, currentBranch: 'feature/branch' });
      mockGitService.getRemotes.mockResolvedValue({ success: true, remotes: [{ name: 'origin', fetchUrl: 'https://github.com/user/repo.git' }] });
      vi.mocked(getDeepLinkUrl).mockReturnValue('https://github.com/user/repo');
      registerVcsIpc({ getGitService: () => mockGitService as unknown as GitService });
      const handler = (channel: string) => mockIpcMain.handle.mock.calls.find((call) => call[0] === channel)?.[1] as
        (_: unknown, path: string, type: DeepLink['type']) => Promise<unknown>;
      expect(await handler('vcs:get-deep-link')(null, '/valid/path', type)).toBe('https://github.com/user/repo');
      expect(await handler('vcs:open-deep-link')(null, '/valid/path', type)).toBe(true);
      expect(shell.openExternal).toHaveBeenCalledWith('https://github.com/user/repo');
      expect(getProviderContext).not.toHaveBeenCalled();
      expect(getProviderPrLink).not.toHaveBeenCalled();
    }
  );

  test('PR navigation discovers only PR identity and does not invent a detached branch', async () => {
    vi.mocked(getValidatedWorkspacePath).mockReturnValue('/valid/path');
    mockGitService.getBranchState.mockResolvedValue({ success: true, currentBranch: undefined });
    mockGitService.getRemotes.mockResolvedValue({ success: true, remotes: [{ name: 'origin', fetchUrl: 'https://github.com/user/repo.git' }] });
    vi.mocked(getProviderPrLink).mockResolvedValue(null);
    registerVcsIpc({ getGitService: () => mockGitService as unknown as GitService });
    const handler = mockIpcMain.handle.mock.calls.find((call) => call[0] === 'vcs:get-deep-link')?.[1] as
      (_: unknown, path: string, type: DeepLink['type']) => Promise<unknown>;
    expect(await handler(null, '/valid/path', 'pr')).toBeNull();
    expect(getProviderPrLink).toHaveBeenCalledWith('https://github.com/user/repo.git', undefined);
    expect(getProviderContext).not.toHaveBeenCalled();
  });

  test('uses registered SSH workspace identity for provider metadata at the same local path', async () => {
    vi.mocked(getValidatedWorkspacePath).mockReturnValue('/same/path');
    vi.mocked(mockGitService.getBranchState).mockResolvedValue({
      success: true, currentBranch: 'remote-branch',
    });
    vi.mocked(mockGitService.getRemotes).mockResolvedValue({
      success: true, remotes: [{ name: 'origin', fetchUrl: 'git@remote:org/project.git' }],
    });
    vi.mocked(getProviderContext).mockResolvedValue({
      success: true,
    });
    const remote = {
      workspaceId: 'remote-id',
      location: { path: '/same/path', environmentId: 'dev-vps' },
    };
    registerVcsIpc({
      getGitService: () => mockGitService as unknown as GitService,
      getWorkspaceRegistry: () => ({
        getWorkspace: (id: string) => id === remote.workspaceId ? remote : null,
      }) as never,
    });
    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'vcs:get-context'
    )?.[1] as (_: unknown, path: string, id: string) => Promise<ProviderContextResult>;
    const result = await handler(null, '/same/path', 'remote-id');
    expect(result.success).toBe(true);
    expect(mockGitService.withWorkspace).toHaveBeenCalledWith(
      { workspaceId: 'remote-id', workspacePath: '/same/path', environmentId: 'dev-vps' },
      expect.any(Function)
    );
    expect(getProviderContext).toHaveBeenCalledWith('origin', 'git@remote:org/project.git', 'remote-branch');
    expect(getValidatedWorkspacePath).not.toHaveBeenCalled();
    expect(await handler(null, '/same/path', 'stale-id')).toMatchObject({ success: false });
  });
});
