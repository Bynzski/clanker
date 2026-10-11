import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentAttentionBroker } from '../../../src/main/agentAttentionBroker';
import { createAgentLocationResolver } from '../../../src/main/agentLocation';
import { checkoutTerminalUsages, localCheckoutUsagePaths } from '../../../src/main/checkoutOccupancy';
import { countTerminalsUsingContext, releaseCheckoutContext, type TerminalUsage } from '../../../src/main/checkoutContextRelease';
import { WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import { guardWorktreePrune } from '../../../src/main/worktreePruneGuard';
import { RemoteWorktreeCoordinator } from '../../../src/main/remote/remoteWorktreeCoordinator';
import type { WorkspaceEnvironment } from '../../../src/main/environment/workspaceEnvironment';
import { toPosixPath } from '../../../src/shared/pathNormalize';

const brokers: AgentAttentionBroker[] = [];
const directories: string[] = [];
afterEach(() => {
  brokers.splice(0).forEach((broker) => broker.close());
  directories.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});

async function setup(environmentId = 'local') {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-occupancy-')));
  directories.push(dir);
  const main = environmentId === 'local' ? toPosixPath(path.join(dir, 'main')) : '/srv/main';
  const worktree = environmentId === 'local' ? toPosixPath(path.join(dir, 'worktree')) : '/srv/worktree';
  if (environmentId === 'local') for (const root of [main, worktree]) fs.mkdirSync(root);
  const registry = new WorkspaceRegistry((id) => ({
    id, kind: id === 'local' ? 'local' : 'ssh', worktreeResourceId: id === 'other-host' ? 'ssh:other' : 'ssh:host',
    validateWorkspacePath: async (root: string) => ({ valid: true, resolvedPath: root }),
  }) as unknown as WorkspaceEnvironment);
  await registry.registerWorkspace({ workspaceId: 'ws', workspacePath: main, environmentId });
  const context = (await registry.registerCheckoutContext({ workspaceId: 'ws', path: worktree, kind: 'worktree' })).checkoutContext!;
  const launch = registry.resolveCheckoutContext('ws')!;
  const terminal = { workspaceId: 'ws', checkoutContextId: launch.id, environmentId, cwd: main, remoteWorkingDir: main };
  const terminals = new Map<string, typeof terminal>([['t', terminal]]);
  const broker = new AgentAttentionBroker(() => undefined, () => undefined, Date.now, {
    resolveLocation: createAgentLocationResolver({ getTerminal: (id) => terminals.get(id), getCheckoutContexts: (id) => registry.getCheckoutContextsForWorkspace(id) }),
  });
  brokers.push(broker);
  const token = environmentId === 'local' ? (await broker.register('t', 'pi')).CLANKER_ATTENTION_TOKEN : broker.registerRemote('t', 'pi');
  const send = (event: string, fields: object = {}) => {
    const raw = JSON.stringify({ version: 1, token, harness: 'pi', event, scope: 'root', sessionId: 's', ...fields });
    return environmentId === 'local' ? broker.receive(raw) : broker.receiveRemote('t', raw);
  };
  const usages = () => checkoutTerminalUsages(terminals, (id) => broker.locationObservation(id)?.location ?? null);
  const release = () => releaseCheckoutContext({ registry, terminals: usages().map(([, usage]) => usage), workspaceId: 'ws', checkoutContextId: context.id });
  return { dir, registry, broker, send, terminals, terminal, usages, release, context, launch, main, worktree };
}

describe('live authenticated observed occupancy (never launch authority)', () => {
  it.each(['local', 'ssh'])('blocks release/count/prune for a main-bound agent observed in another checkout (%s)', async (environmentId) => {
    const f = await setup(environmentId);
    f.send('turn_started', { turnId: 'turn', cwd: `${f.worktree}/src` });
    expect(f.release()).toMatchObject({ success: false, activeTerminals: 1 });
    expect(countTerminalsUsingContext(f.registry, f.context, f.usages())).toBe(1);
    expect(countTerminalsUsingContext(f.registry, f.context, f.usages(), 't')).toBe(0);
    expect(guardWorktreePrune(f.registry, environmentId, [{ path: f.worktree, branch: 'task', isMain: false, isLocked: false, isPrunable: true }], f.usages().map(([, usage]) => usage))).toContain('Cannot prune');
    expect(f.terminal).toMatchObject({ checkoutContextId: f.launch.id, cwd: f.main, remoteWorkingDir: f.main });
    expect(f.registry.resolveCheckoutContext('ws', f.context.id)).toEqual(f.context);
  });

  it('idle, session-boundary and lifecycle-lost evidence blocks until a newer report or agent exit', async () => {
    const f = await setup();
    f.send('turn_started', { turnId: 'turn', cwd: f.worktree });
    f.send('turn_completed', { turnId: 'turn' });
    expect(f.release().success).toBe(false);
    f.send('session_ended');
    expect(f.broker.locationObservation('t')?.state).toBe('last-reported');
    expect(f.release().success).toBe(false);
    f.send('turn_started', { sessionId: 'next', turnId: 'next' });
    f.broker.markLifecycleLost('t');
    expect(f.release().success).toBe(false);
    f.send('location_changed', { sessionId: 'next', cwd: f.main });
    expect(countTerminalsUsingContext(f.registry, f.context, f.usages())).toBe(0);
    f.send('location_changed', { sessionId: 'next', cwd: f.worktree });
    f.send('agent_exited');
    // Fallback shell remains in main, but the exited harness cannot retain observed occupancy.
    expect(f.terminals.size).toBe(1);
    expect(f.release()).toEqual({ success: true });
  });

  it('does not include a historical snapshot whose terminal is no longer live', async () => {
    const f = await setup();
    f.send('session_started', { cwd: f.worktree });
    f.terminals.delete('t');
    expect(f.broker.locationObservation('t')).not.toBeNull();
    expect(f.release()).toEqual({ success: true });
  });

  it('a child, wrong session or retired turn cannot clear observed occupancy', async () => {
    const f = await setup();
    f.send('turn_started', { turnId: 'one', cwd: f.worktree });
    f.send('turn_completed', { turnId: 'one' });
    f.send('turn_started', { turnId: 'two' });
    for (const fields of [{ scope: 'child' }, { sessionId: 'other' }, { turnId: 'one' }]) {
      f.send('turn_completed', { turnId: 'two', cwd: f.main, ...fields });
      expect(f.release().success).toBe(false);
    }
  });

  it('uses containment even for unregistered observed paths and missing Git roots', async () => {
    const f = await setup();
    const unknown = `${f.worktree}-unmanaged`;
    f.send('session_started', { cwd: `${unknown}/src` });
    expect(f.broker.snapshot('t')?.location?.checkoutContextId).toBeNull();
    expect(guardWorktreePrune(f.registry, 'local', [{ path: unknown, branch: 'gone', isMain: false, isLocked: false, isPrunable: true }], f.usages().map(([, usage]) => usage))).toContain('Cannot prune');
    expect(f.release()).toEqual({ success: true });
  });

  it.skipIf(process.platform === 'win32')('matches local symlinks and removed tails', async () => {
    const f = await setup();
    const alias = path.join(f.dir, 'alias');
    fs.symlinkSync(f.worktree, alias);
    f.send('session_started', { cwd: toPosixPath(path.join(alias, 'removed', 'subdir')) });
    expect(f.release().success).toBe(false);
  });

  it('adds observed occupancy across equivalent SSH targets, but isolates another host and local paths', async () => {
    const f = await setup('ssh');
    await f.registry.registerWorkspace({ workspaceId: 'alias', workspacePath: '/srv/alias', environmentId: 'alias' });
    await f.registry.registerWorkspace({ workspaceId: 'other', workspacePath: '/srv/other', environmentId: 'other-host' });
    const usage: TerminalUsage = { environmentId: 'alias', remoteWorkingDir: '/srv/main', observedLocation: { path: f.worktree, checkoutContextId: null } };
    expect(countTerminalsUsingContext(f.registry, f.context, [['t', usage]])).toBe(1);
    expect(countTerminalsUsingContext(f.registry, f.context, [['t', { ...usage, environmentId: 'other-host' }]])).toBe(0);
    expect(countTerminalsUsingContext(f.registry, f.context, [['t', { ...usage, environmentId: 'local' }]])).toBe(0);
  });

  it('unknown recorded directories still block and launch bindings remain occupied after a move', async () => {
    const f = await setup();
    f.send('session_started', { cwd: f.main });
    const unknown = { observedLocation: { path: f.main, checkoutContextId: f.launch.id } };
    expect(countTerminalsUsingContext(f.registry, f.context, [['unknown', unknown]])).toBe(1);
    expect(localCheckoutUsagePaths([unknown])).toBeNull();
    f.terminal.checkoutContextId = f.context.id;
    expect(f.release().success).toBe(false);
  });

  it('copies evidence without modifying terminals and filters SSH desktop cwd out of local Git checks', async () => {
    const f = await setup();
    f.send('session_started', { cwd: f.worktree });
    const entries = f.usages();
    expect(entries[0][1]).not.toBe(f.terminal);
    expect('observedLocation' in f.terminal).toBe(false);
    expect(localCheckoutUsagePaths([entries[0][1], { environmentId: 'ssh', cwd: f.worktree, observedLocation: { path: '/srv/remote', checkoutContextId: null } }])).toEqual([f.main, f.worktree]);
  });

  it('feeds observed unregistered paths into SSH inspection/removal without losing reservation checks', async () => {
    const f = await setup('ssh');
    f.send('session_started', { cwd: '/srv/unmanaged/src' });
    const coordinator = new RemoteWorktreeCoordinator(() => f.registry, () => f.usages().flatMap(([, usage]) => [usage.remoteWorkingDir, ...(usage.observedLocation ? [usage.observedLocation.path] : [])]));
    const workspace = f.registry.getWorkspace('ws')!;
    Object.assign(workspace.environment, { inspectWorktree: async () => { throw new Error('Must not dispatch'); }, removeWorktree: async () => { throw new Error('Must not dispatch'); }, waitForWorktreeOperations: async () => undefined });
    expect(await coordinator.inspect(workspace, '/srv/unmanaged')).toMatchObject({ success: false, error: expect.stringContaining('active terminals') });
    expect(await coordinator.remove(workspace, '/srv/unmanaged', 'task')).toMatchObject({ success: false });
    expect(f.registry.isRemotePathReserved('ssh', '/srv/unmanaged')).toBe(false);
  });
});
