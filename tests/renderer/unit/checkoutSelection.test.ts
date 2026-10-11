import { describe, expect, it } from 'vitest';
import { selectCheckout, checkoutSelectionKey } from '../../../src/renderer/lib/checkoutSelection';
import { createWorkspaceFixture, createTerminalFixture } from '../../setup/fixtures';
import { snapshot } from '../../_helpers/attentionSnapshots';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';
const main: CheckoutContext = { id: 'ws::main', workspaceId: 'ws', environmentId: 'local', kind: 'main', path: '/repo' };
const a: CheckoutContext = { ...main, id: 'ws::a', kind: 'worktree', path: '/repo-worktrees/a', branch: 'a' };
const b: CheckoutContext = { ...a, id: 'ws::b', path: '/repo-worktrees/b', branch: 'b' };
const workspace = () => createWorkspaceFixture({ id: 'ws', workspacePath: main.path, checkoutContexts: [main, a, b], terminals: [createTerminalFixture({ id: 'agent', checkoutContextId: a.id })], activeTerminalId: 'agent' });
const observed = () => snapshot('agent', 'idle', 1, { location: { path: `${b.path}/src`, checkoutContextId: b.id }, locationProvenance: { state: 'current', sessionId: 'S' } });
describe('canonical registered-checkout selection (not execution authority)', () => {
  it('uses explicit pin > current observation > launch if absent > workspace; it never mutates launch bindings', () => {
    const ws = workspace(), report = observed();
    expect(selectCheckout({ ...ws, fileSurfaceContextId: main.id }, report)).toMatchObject({ source: 'explicit', root: main.path });
    expect(selectCheckout(ws, report)).toMatchObject({ source: 'observed', root: b.path });
    expect(selectCheckout(ws)).toMatchObject({ source: 'launch', root: a.path });
    expect(selectCheckout({ ...ws, activeTerminalId: null })).toMatchObject({ source: 'workspace', root: main.path });
    expect(ws.terminals[0].checkoutContextId).toBe(a.id);
  });
  it.each([
    ['last-reported', 'historical-observation'], ['unavailable', 'unavailable-observation'],
  ] as const)('never makes %s observations current via fallback', (state, reason) => {
    const report = observed(); report.locationProvenance = { state, sessionId: 'old' };
    expect(selectCheckout(workspace(), report)).toMatchObject({ availability: 'unavailable', root: null, reason, contextId: b.id });
    expect(selectCheckout({ ...workspace(), fileSurfaceContextId: a.id }, report)).toMatchObject({ availability: 'available', source: 'explicit', root: a.path });
  });
  it('distinguishes missing, released, unknown and unregistered observations', () => {
    const report = observed(), ws = workspace();
    expect(selectCheckout(ws, { ...report, locationProvenance: null })).toMatchObject({ reason: 'unknown-provenance' });
    expect(selectCheckout(ws, { ...report, location: { path: '/outside', checkoutContextId: null } })).toMatchObject({ reason: 'unregistered-observation' });
    expect(selectCheckout({ ...ws, checkoutContexts: [main, a] }, report)).toMatchObject({ reason: 'released-checkout' });
    expect(selectCheckout({ ...ws, checkoutContexts: [main, a, { ...b, missing: true }] }, report)).toMatchObject({ reason: 'missing-checkout' });
    expect(selectCheckout({ ...ws, fileSurfaceContextId: 'released' })).toMatchObject({ source: 'explicit', reason: 'released-checkout' });
  });
  it.each([{ environmentId: 'other-host' }, { workspaceId: 'other-workspace' }, { path: 'relative' }])('refuses foreign or invalid registered identities %j', (invalid) => {
    expect(selectCheckout({ ...workspace(), checkoutContexts: [{ ...b, ...invalid }] }, observed())).toMatchObject({ availability: 'unavailable', reason: 'invalid-checkout' });
  });
  it('backfills only the implicit registered main root, including legacy linked-worktree workspaces', () => {
    const ws = { ...workspace(), terminals: [], activeTerminalId: null, checkoutContexts: [a] };
    expect(selectCheckout(ws)).toMatchObject({ contextId: main.id, root: main.path });
    expect(selectCheckout({ ...ws, fileSurfaceContextId: 'unknown' })).toMatchObject({ availability: 'unavailable' });
    expect(selectCheckout({ ...ws, workspacePath: 'relative' })).toMatchObject({ reason: 'invalid-checkout' });
  });
  it('keys only physical identity and availability, never branch/source/agent noise', () => {
    const ws = workspace(), report = observed();
    const key = checkoutSelectionKey(selectCheckout(ws, report));
    expect(checkoutSelectionKey(selectCheckout({ ...ws, fileSurfaceContextId: b.id }, report))).toBe(key);
    expect(checkoutSelectionKey(selectCheckout({ ...ws, checkoutContexts: [main, a, { ...b, branch: 'renamed' }] }, report))).toBe(key);
    expect(checkoutSelectionKey(selectCheckout({ ...ws, fileSurfaceContextId: a.id }, report))).not.toBe(key);
  });
});
