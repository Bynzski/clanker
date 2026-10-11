import { describe, expect, it } from 'vitest';
import { selectedVcsCheckoutId } from '../../../src/renderer/lib/vcsCheckout';
import { selectCheckout } from '../../../src/renderer/lib/checkoutSelection';
import type { WorkspaceTab } from '../../../src/renderer/store/workspaceTypes';
const observed = (path: string, checkoutContextId: string | null) => ({ location: { path, checkoutContextId }, locationProvenance: { state: 'current' as const, sessionId: 's' } });
function workspace(): WorkspaceTab {
  return { id: 'ws', workspacePath: '/repo', environmentId: 'local', activeTerminalId: 'terminal', terminals: [{ id: 'terminal', checkoutContextId: 'isolated' }],
    checkoutContexts: [{ id: 'ws::main', workspaceId: 'ws', environmentId: 'local', path: '/repo', kind: 'main' },
      { id: 'isolated', workspaceId: 'ws', environmentId: 'local', path: '/repo-worktrees/topic', kind: 'worktree' }] } as WorkspaceTab;
}
describe('canonical registered surface selection', () => {
  it('uses launch only without observation and follows a current registered observation', () => {
    const ws = workspace(); expect(selectedVcsCheckoutId(ws)).toBe('isolated');
    expect(selectedVcsCheckoutId(ws, observed('/repo', 'ws::main'))).toBeUndefined();
    expect(selectCheckout(ws).source).toBe('launch');
  });
  it('never derives authority from paths or falls back from an unregistered report', () => {
    expect(selectedVcsCheckoutId(workspace(), observed('/repo-worktrees/topic', null))).toBeNull();
    expect(selectedVcsCheckoutId(workspace(), observed('/repo', 'foreign'))).toBeNull();
  });
  it('honors an explicit pin and retains its identity when missing or released', () => {
    const ws = workspace(); ws.fileSurfaceContextId = 'ws::main';
    expect(selectedVcsCheckoutId(ws, observed('/other', null))).toBeUndefined();
    ws.fileSurfaceContextId = 'isolated'; ws.checkoutContexts![1].missing = true;
    expect(selectCheckout(ws)).toMatchObject({ availability: 'unavailable', reason: 'missing-checkout', contextId: 'isolated', source: 'explicit', root: null });
    ws.checkoutContexts![1].missing = false; ws.checkoutContexts![1].environmentId = 'ssh:other'; expect(selectedVcsCheckoutId(ws)).toBeNull();
    ws.checkoutContexts = ws.checkoutContexts!.slice(0, 1);
    expect(selectCheckout(ws)).toMatchObject({ reason: 'released-checkout', contextId: 'isolated' });
  });
  it('distinguishes historical and unknown provenance from absent observation', () => {
    const ws = workspace(); const snapshot = observed('/repo-worktrees/topic', 'isolated');
    expect(selectCheckout(ws, { ...snapshot, locationProvenance: { state: 'last-reported', sessionId: 'old' } })).toMatchObject({ availability: 'available', source: 'launch', root: '/repo-worktrees/topic', historicalLaunchFallback: true });
    expect(selectCheckout(ws, { ...observed('/repo', 'ws::main'), locationProvenance: { state: 'last-reported', sessionId: 'old' } })).toMatchObject({ reason: 'historical-observation', root: null });
    expect(selectCheckout(ws, { location: snapshot.location })).toMatchObject({ reason: 'unknown-provenance' });
    expect(selectCheckout(ws, { location: null })).toMatchObject({ availability: 'available', source: 'launch' });
    ws.workspacePath = ''; expect(selectCheckout(ws)).toMatchObject({ reason: 'invalid-workspace' });
  });
});
