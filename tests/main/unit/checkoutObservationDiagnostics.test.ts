import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CheckoutObservationDiagnostics } from '../../../src/main/checkoutObservationDiagnostics';
import type { AgentAttentionSnapshot } from '../../../src/shared/types/agentAttention';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';

const main: CheckoutContext = { id: 'private-main-id', workspaceId: 'private-workspace', environmentId: 'local', path: '/private/project', kind: 'main' };
const linked: CheckoutContext = { ...main, id: 'private-linked-id', path: '/private/project-worktrees/topic', kind: 'worktree' };
const terminal = { workspaceId: main.workspaceId, checkoutContextId: main.id };
const observation = (locationPath = main.path, contextId: string | null = main.id): Pick<AgentAttentionSnapshot, 'revision' | 'location' | 'locationProvenance'> => ({
  revision: 4, location: { path: locationPath, checkoutContextId: contextId }, locationProvenance: { state: 'current', sessionId: 'private-session' },
});
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('checkout observation diagnostics', () => {
  it('records only relationship facts for main, external, other registered, and released observations', () => {
    const write = vi.fn();
    const diagnostics = new CheckoutObservationDiagnostics(write, () => 100);
    const emit = (value: ReturnType<typeof observation>, contexts = [main, linked]) => diagnostics.observe('term-a', 'remote', value, terminal, contexts);
    emit(observation());
    expect(write.mock.lastCall?.[0]).toMatchObject({ at: 100, revision: 4, launchRegistered: true, provenance: 'current', observedContext: 'launch', resolutionAgrees: true, lexicallyInsideLaunch: true, resolvedInsideLaunch: true });
    emit(observation('/private/elsewhere', null));
    expect(write.mock.lastCall?.[0]).toMatchObject({ observedContext: 'unregistered', resolutionAgrees: true, resolvedInsideLaunch: false });
    emit(observation(linked.path, linked.id));
    expect(write.mock.lastCall?.[0]).toMatchObject({ observedContext: 'other-registered', resolutionAgrees: true });
    emit(observation(linked.path, linked.id), [main]);
    expect(write.mock.lastCall?.[0]).toMatchObject({ observedContext: 'released', resolutionAgrees: false });
    const serialized = JSON.stringify(write.mock.calls);
    for (const secret of ['/private', 'private-main-id', 'private-linked-id', 'private-session', 'private-workspace']) expect(serialized).not.toContain(secret);
  });

  it('detects an unregistered report inside a registered main root without repairing or mutating it', () => {
    const write = vi.fn();
    const diagnostics = new CheckoutObservationDiagnostics(write);
    const value = observation(`${main.path}/src`, null);
    const before = JSON.stringify(value);
    diagnostics.observe('term-a', 'remote', value, terminal, [main]);
    expect(write.mock.lastCall?.[0]).toMatchObject({ observedContext: 'unregistered', resolutionAgrees: false, lexicallyInsideLaunch: true, resolvedInsideLaunch: true });
    expect(JSON.stringify(value)).toBe(before);
  });

  it.skipIf(process.platform === 'win32')('distinguishes lexical and symlink-aware local containment', () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'checkout-diagnostic-')));
    dirs.push(root);
    fs.mkdirSync(path.join(root, 'real')); fs.symlinkSync(path.join(root, 'real'), path.join(root, 'alias'));
    const context = { ...main, path: path.join(root, 'alias') };
    const write = vi.fn();
    new CheckoutObservationDiagnostics(write).observe('term-a', 'local', observation(path.join(root, 'real'), main.id), terminal, [context]);
    expect(write.mock.lastCall?.[0]).toMatchObject({ resolutionAgrees: true, lexicallyInsideLaunch: false, resolvedInsideLaunch: true });
  });

  it('records provenance and registration transitions, not repeated lifecycle revisions', () => {
    const write = vi.fn();
    const diagnostics = new CheckoutObservationDiagnostics(write);
    const value = observation();
    diagnostics.observe('term-a', 'remote', value, terminal, [main]);
    diagnostics.observe('term-a', 'remote', { ...value, revision: 5 }, terminal, [main]);
    expect(write).toHaveBeenCalledTimes(1);
    diagnostics.observe('term-a', 'remote', { ...value, locationProvenance: { state: 'last-reported', sessionId: 'private-session' } }, terminal, [main]);
    expect(write.mock.lastCall?.[0].provenance).toBe('last-reported');
    diagnostics.observe('term-a', 'remote', value, undefined, [main]);
    expect(write.mock.lastCall?.[0]).toMatchObject({ terminalPresent: false, workspaceBound: false, launchRegistered: false, registeredContexts: 0, observedContext: 'released' });
    diagnostics.observe('term-a', 'remote', { ...value, location: null }, terminal, [main]);
    expect(write.mock.lastCall?.[0]).toMatchObject({ provenance: 'none', observedContext: 'none', resolutionAgrees: null });
  });

  it('bounds in-memory keys and clears terminal history on retirement', () => {
    const write = vi.fn();
    const diagnostics = new CheckoutObservationDiagnostics(write);
    for (let index = 0; index < 65; index++) diagnostics.observe(`term-${index}`, 'remote', observation(), terminal, [main]);
    diagnostics.observe('term-0', 'remote', observation(), terminal, [main]);
    expect(write).toHaveBeenCalledTimes(66);
    diagnostics.observe('term-0', 'remote', null, undefined, []);
    expect(write).toHaveBeenCalledTimes(66);
    diagnostics.observe('term-0', 'remote', observation(), terminal, [main]);
    expect(write).toHaveBeenCalledTimes(67);
  });
});
