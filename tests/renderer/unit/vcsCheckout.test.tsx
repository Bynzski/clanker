import { describe, expect, it } from 'vitest';
import { selectedVcsCheckoutId } from '../../../src/renderer/lib/vcsCheckout';
import type { WorkspaceTab } from '../../../src/renderer/store/workspaceTypes';
function workspace(): WorkspaceTab {
  // Only the identity fields used by this selector; no terminal or filesystem authority is mocked.
  return { id: 'ws', environmentId: 'local', activeTerminalId: 'terminal', terminals: [{ id: 'terminal', checkoutContextId: 'isolated' }],
    checkoutContexts: [{ id: 'ws::main', workspaceId: 'ws', environmentId: 'local', path: '/repo', kind: 'main' },
      { id: 'isolated', workspaceId: 'ws', environmentId: 'local', path: '/repo-worktrees/topic', kind: 'worktree' }] } as WorkspaceTab;
}
describe('registered focused VCS identity only', () => {
  it('uses launch context until main reports a different registered location', () => {
    const ws = workspace(); expect(selectedVcsCheckoutId(ws)).toBe('isolated');
    expect(selectedVcsCheckoutId(ws, { path: '/repo', checkoutContextId: 'ws::main' })).toBeUndefined();
  });
  it('never derives identity from cwd text or falls back from an unassociated reported location', () => {
    expect(selectedVcsCheckoutId(workspace(), { path: '/repo-worktrees/topic', checkoutContextId: null })).toBeNull();
    expect(selectedVcsCheckoutId(workspace(), { path: '/repo', checkoutContextId: 'foreign' })).toBeNull();
  });
  it('honors an explicitly focused editor root, but rejects missing, foreign or released contexts', () => {
    const ws = workspace(); ws.fileSurfaceContextId = 'ws::main';
    expect(selectedVcsCheckoutId(ws, { path: '/other', checkoutContextId: null })).toBeUndefined();
    ws.fileSurfaceContextId = 'isolated'; ws.checkoutContexts![1].missing = true; expect(selectedVcsCheckoutId(ws)).toBeNull();
    ws.checkoutContexts![1].missing = false; ws.checkoutContexts![1].environmentId = 'ssh:other'; expect(selectedVcsCheckoutId(ws)).toBeNull();
    ws.checkoutContexts = ws.checkoutContexts!.slice(0, 1); expect(selectedVcsCheckoutId(ws)).toBeNull();
  });
});
