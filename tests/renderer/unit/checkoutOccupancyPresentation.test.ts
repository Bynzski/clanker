import { beforeEach, describe, expect, it } from 'vitest';
import { isCheckoutContextInUse } from '../../../src/renderer/lib/worktreeAgents';
import { useAgentAttentionStore } from '../../../src/renderer/store/agentAttentionStore';
import { useWorkspaceServiceStore } from '../../../src/renderer/store/workspaceServiceStore';
import { createWorkspaceFixture, createTerminalFixture } from '../../setup/fixtures';
import { EMPTY_ATTENTION, snapshot, storeState } from '../../_helpers/attentionSnapshots';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';
import type { WorkspaceService } from '../../../src/shared/types/workspaceServices';
const main: CheckoutContext = { id: 'ws::main', workspaceId: 'ws', environmentId: 'local', path: '/repo', kind: 'main' };
const a: CheckoutContext = { ...main, id: 'ws::a', path: '/repo-worktrees/a', kind: 'worktree' };
const b: CheckoutContext = { ...a, id: 'ws::b', path: '/repo-worktrees/b' };
const ws = () => createWorkspaceFixture({ id: 'ws', checkoutContexts: [main, a, b], terminals: [createTerminalFixture({ id: 'agent', checkoutContextId: main.id })] });
beforeEach(() => { useAgentAttentionStore.setState(EMPTY_ATTENTION); useWorkspaceServiceStore.setState({ services: [] }); });
describe('conservative occupancy labels, not cleanup authority', () => {
  it.each(['current', 'last-reported', 'unavailable'] as const)('retains %s observation containment and launch occupancy independently', (state) => {
    useAgentAttentionStore.setState(storeState([snapshot('agent', 'idle', 1, { location: { path: `${a.path}/src`, checkoutContextId: a.id }, locationProvenance: { state, sessionId: 'S' } })]));
    expect(isCheckoutContextInUse(ws(), main)).toBe(true);
    expect(isCheckoutContextInUse(ws(), a)).toBe(true);
    expect(getUnusedWorktreeContexts(ws()).map((context) => context.id)).toEqual([b.id]);
    expect(ws().terminals[0].checkoutContextId).toBe(main.id);
  });
  it('uses unregistered observed containment for an unmanaged root without confusing path prefixes or retired terminals', () => {
    useAgentAttentionStore.setState(storeState([snapshot('agent', 'idle', 1, { location: { path: `${a.path}/src`, checkoutContextId: null } })]));
    expect(isCheckoutContextInUse(ws(), { id: '', path: a.path })).toBe(true);
    expect(isCheckoutContextInUse(ws(), { id: '', path: '/repo-worktrees/ab' })).toBe(false);
    expect(isCheckoutContextInUse({ ...ws(), terminals: [] }, a)).toBe(false);
    useAgentAttentionStore.getState().applyChange({ terminalId: 'agent', revision: 2, snapshot: null }, false);
    expect(getUnusedWorktreeContexts(ws()).map((context) => context.id)).toEqual([a.id, b.id]);
  });
  it.each(['starting', 'running', 'stopping', 'failed'] as const)('keeps live/cleanup-incomplete %s services occupied after the conversation closes', (status) => {
    const service: WorkspaceService = { id: 'service', sourceTerminalId: 'closed', workspaceId: 'ws', checkoutContextId: a.id, checkoutRoot: a.path, cwd: a.path, command: 'npm run dev', packageManager: 'npm', status, cleanupIncomplete: status === 'failed' };
    useWorkspaceServiceStore.setState({ services: [service] });
    expect(getUnusedWorktreeContexts({ ...ws(), terminals: [] }).map((context) => context.id)).toEqual([b.id]);
    useWorkspaceServiceStore.setState({ services: [{ ...service, workspaceId: 'foreign' }] });
    expect(isCheckoutContextInUse(ws(), a)).toBe(false);
    useWorkspaceServiceStore.setState({ services: [{ ...service, status: 'stopped', cleanupIncomplete: false }] });
    expect(isCheckoutContextInUse(ws(), a)).toBe(false);
  });
});

function getUnusedWorktreeContexts(workspace: { id: string; checkoutContexts?: import('../../../src/shared/types/checkoutContext').CheckoutContext[]; terminals: import('../../../src/renderer/store/workspaceTypes').Terminal[] }) {
  return (workspace.checkoutContexts ?? []).filter((context) => context.kind === 'worktree' && context.id !== `${workspace.id}::main` && !context.missing && !isCheckoutContextInUse(workspace, context));
}
