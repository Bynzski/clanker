import { describe, expect, it } from 'vitest';
import { gitManagementScope } from '../../../../src/renderer/components/git/gitManagementScope';
import { useWorkspaceStore } from '../../../../src/renderer/store/workspaceStore';
import { useAgentAttentionStore } from '../../../../src/renderer/store/agentAttentionStore';
import { createWorkspaceFixture, createTerminalFixture } from '../../../setup/fixtures';
import { snapshot } from '../../../_helpers/attentionSnapshots';

describe('gitManagementScope checkout-aware authorization', () => {
  it('authorizes the workspace root when main checkout is selected', () => {
    useWorkspaceStore.setState({
      activeWorkspaceId: 'ws-1',
      workspaces: [createWorkspaceFixture({
        id: 'ws-1',
        workspacePath: '/projects/repo',
        environmentId: 'local',
        checkoutContexts: [
          { id: 'ws-1::main', workspaceId: 'ws-1', environmentId: 'local', path: '/projects/repo', kind: 'main' },
        ],
      })],
    });

    const scope = gitManagementScope('/projects/repo', 'ws-1');
    expect(scope.blocked).toBeNull();
    expect(scope.checkoutContextId).toBeUndefined();
    expect(scope.path).toBe('/projects/repo');
    expect(scope.checkoutLabel).toBe('Workspace checkout');
  });

  it('authorizes a registered isolated worktree checkout when selected by agent location', () => {
    const mainCtx = { id: 'ws-1::main', workspaceId: 'ws-1', environmentId: 'local', path: '/projects/repo', kind: 'main' as const };
    const worktreeCtx = { id: 'ws-1::ckt-worktree', workspaceId: 'ws-1', environmentId: 'local', path: '/projects/repo-worktrees/feat', kind: 'worktree' as const, branch: 'feat' };

    useWorkspaceStore.setState({
      activeWorkspaceId: 'ws-1',
      workspaces: [createWorkspaceFixture({
        id: 'ws-1',
        workspacePath: '/projects/repo',
        environmentId: 'local',
        activeTerminalId: 'term-1',
        terminals: [createTerminalFixture({ id: 'term-1', checkoutContextId: 'ws-1::ckt-worktree' })],
        checkoutContexts: [mainCtx, worktreeCtx],
      })],
    });
    useAgentAttentionStore.setState({
      byTerminalId: {
        'term-1': snapshot('term-1', 'completed', 1, { location: { path: worktreeCtx.path, checkoutContextId: worktreeCtx.id } }),
      },
    });

    const scope = gitManagementScope('/projects/repo', 'ws-1');
    expect(scope.blocked).toBeNull();
    expect(scope.checkoutContextId).toBe('ws-1::ckt-worktree');
    expect(scope.path).toBe('/projects/repo-worktrees/feat');
    expect(scope.checkoutLabel).toBe('feat');
  });

  it('fails closed when the selected checkout context is marked missing', () => {
    const mainCtx = { id: 'ws-1::main', workspaceId: 'ws-1', environmentId: 'local', path: '/projects/repo', kind: 'main' as const };
    const missingCtx = { id: 'ws-1::ckt-missing', workspaceId: 'ws-1', environmentId: 'local', path: '/projects/repo-worktrees/gone', kind: 'worktree' as const, branch: 'gone', missing: true };

    useWorkspaceStore.setState({
      activeWorkspaceId: 'ws-1',
      workspaces: [createWorkspaceFixture({
        id: 'ws-1',
        workspacePath: '/projects/repo',
        environmentId: 'local',
        activeTerminalId: 'term-1',
        terminals: [createTerminalFixture({ id: 'term-1', checkoutContextId: 'ws-1::ckt-missing' })],
        checkoutContexts: [mainCtx, missingCtx],
      })],
    });
    useAgentAttentionStore.setState({
      byTerminalId: {
        'term-1': snapshot('term-1', 'completed', 1, { location: { path: missingCtx.path, checkoutContextId: missingCtx.id } }),
      },
    });

    const scope = gitManagementScope('/projects/repo', 'ws-1');
    expect(scope.blocked).toBe('The selected checkout is unavailable. Select a registered checkout before managing Git.');
    expect(scope.checkoutContextId).toBeUndefined();
  });

  it('fails closed when agent location resolves to an unknown checkout context id', () => {
    useWorkspaceStore.setState({
      activeWorkspaceId: 'ws-1',
      workspaces: [createWorkspaceFixture({
        id: 'ws-1',
        workspacePath: '/projects/repo',
        environmentId: 'local',
        activeTerminalId: 'term-1',
        terminals: [createTerminalFixture({ id: 'term-1' })],
        checkoutContexts: [
          { id: 'ws-1::main', workspaceId: 'ws-1', environmentId: 'local', path: '/projects/repo', kind: 'main' },
        ],
      })],
    });
    useAgentAttentionStore.setState({
      byTerminalId: {
        'term-1': snapshot('term-1', 'completed', 1, { location: { path: '/unregistered/path', checkoutContextId: null } }),
      },
    });

    const scope = gitManagementScope('/projects/repo', 'ws-1');
    expect(scope.blocked).toBe('The selected checkout is unavailable. Select a registered checkout before managing Git.');
  });
});
