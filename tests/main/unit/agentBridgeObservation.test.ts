import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import { AgentAttentionBroker } from '../../../src/main/agentAttentionBroker';
import { createAgentLocationResolver } from '../../../src/main/agentLocation';
import { AgentBridgeService } from '../../../src/main/agentBridge/service';
import type { BridgeObservation } from '../../../src/main/agentBridge/observation';
import type { WorkspaceEnvironment } from '../../../src/main/environment/workspaceEnvironment';
import { toPosixPath } from '../../../src/shared/pathNormalize';
let root: string;
let registry: WorkspaceRegistry;
let broker: AgentAttentionBroker;
let bridge: AgentBridgeService;
let send: (event: string, fields?: object) => void;
let call: () => Promise<{ checkout: { kind: string }; observedCheckout: BridgeObservation; capabilities: string[]; providerCapabilities: { checkoutRehome: string | null } }>;
let mainId: string;
let taskId: string;
let taskPath: string;
let mainPath: string;
const terminals = new Map<string, { workspaceId: string; environmentId: string; harnessId: string; checkoutContextId: string; cwd: string }>();
beforeEach(async () => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-mcp-observation-')));
  mainPath = toPosixPath(path.join(root, 'main')); taskPath = toPosixPath(path.join(root, 'task'));
  fs.mkdirSync(mainPath); fs.mkdirSync(taskPath);
  registry = new WorkspaceRegistry(() => ({ id: 'local', kind: 'local', validateWorkspacePath: async (root: string) => ({ valid: true, resolvedPath: root }) }) as unknown as WorkspaceEnvironment);
  await registry.registerWorkspace({ workspaceId: 'ws', workspacePath: mainPath });
  mainId = registry.resolveCheckoutContext('ws')!.id;
  taskId = (await registry.registerCheckoutContext({ workspaceId: 'ws', path: taskPath, kind: 'worktree', branch: 'task' })).checkoutContext!.id;
  terminals.clear(); terminals.set('caller', { workspaceId: 'ws', environmentId: 'local', harnessId: 'pi', checkoutContextId: mainId, cwd: mainPath });
  broker = new AgentAttentionBroker(() => undefined, () => undefined, Date.now, { resolveLocation: createAgentLocationResolver({ getTerminal: (id) => terminals.get(id), getCheckoutContexts: (id) => registry.getCheckoutContextsForWorkspace(id) }) });
  const env = await broker.register('caller', 'pi');
  send = (event, fields = {}) => { broker.receive(JSON.stringify({ version: 1, token: env.CLANKER_ATTENTION_TOKEN, harness: 'pi', event, scope: 'root', sessionId: 's', ...fields })); };
  bridge = new AgentBridgeService({ getRegistry: () => registry, getTerminals: () => terminals, getLocationObservation: (id) => broker.locationObservation(id), version: () => 'test' });
  const lease = await bridge.lease({ terminalId: 'caller', workspaceId: 'ws', environmentId: 'local', harnessId: 'pi', checkoutContextId: mainId });
  const grant = bridge.credentials.resolve(lease.token)!;
  call = async () => (await bridge.callTool(grant, 'clanker_context', {})).data as Awaited<ReturnType<typeof call>>;
});
afterEach(async () => { broker.close(); await bridge.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });
describe('caller-authenticated read-only MCP observation', () => {
  it('describes none/current/historical independently of launch authority and grants', async () => {
    expect((await call()).observedCheckout.state).toBe('none');
    send('turn_started', { turnId: 'one', cwd: taskPath });
    const evidence = broker.locationObservation('caller');
    expect(await call()).toMatchObject({ checkout: { kind: 'main' }, observedCheckout: { state: 'current', matchesLaunch: false, checkout: { branch: 'task', kind: 'worktree' } }, capabilities: ['clanker_context'], providerCapabilities: { checkoutRehome: null } });
    expect(broker.locationObservation('caller')).toEqual(evidence); // A read does not renew lifecycle/location evidence.
    send('turn_completed', { turnId: 'one' });
    expect((await call()).observedCheckout.state).toBe('current');
    send('session_ended'); expect((await call()).observedCheckout).toMatchObject({ state: 'last-reported', provenance: 'last-reported' });
    expect(terminals.get('caller')?.checkoutContextId).toBe(mainId);
    expect(JSON.stringify(await call())).not.toContain(root);
  });
  it('rejects child/stale/session-mismatch clearing, marks lifecycle loss unavailable, and recovers only on a new report', async () => {
    send('turn_started', { turnId: 'one', cwd: taskPath });
    send('turn_completed', { turnId: 'old', cwd: mainPath });
    send('location_changed', { scope: 'child', cwd: mainPath });
    send('location_changed', { sessionId: 'other', cwd: mainPath });
    expect((await call()).observedCheckout.matchesLaunch).toBe(false);
    broker.markLifecycleLost('caller'); expect((await call()).observedCheckout.state).toBe('unavailable');
    send('turn_started', { turnId: 'two', cwd: mainPath });
    expect((await call()).observedCheckout).toMatchObject({ state: 'current', matchesLaunch: true });
    send('agent_exited'); expect((await call()).observedCheckout.state).toBe('none');
  });
  it('distinguishes missing/released/unregistered without leaking raw paths or foreign identities', async () => {
    send('session_started', { cwd: taskPath }); registry.describeCheckoutContext(taskId, { missing: true });
    expect((await call()).observedCheckout.state).toBe('missing');
    registry.unregisterCheckoutContext(taskId); expect((await call()).observedCheckout.state).toBe('released');
    await registry.registerWorkspace({ workspaceId: 'foreign', workspacePath: taskPath });
    send('location_changed', { cwd: taskPath });
    expect((await call()).observedCheckout).toMatchObject({ state: 'unregistered', checkout: null, matchesLaunch: null });
    expect(JSON.stringify(await call())).not.toContain('foreign');
  });
  it('keeps an unregistered report unregistered after later explicit registration until a fresh native report', async () => {
    const unknown = toPosixPath(path.join(root, 'unregistered')); fs.mkdirSync(unknown);
    send('session_started', { cwd: unknown });
    expect((await call()).observedCheckout.state).toBe('unregistered');
    await registry.registerCheckoutContext({ workspaceId: 'ws', path: unknown, kind: 'worktree', branch: 'adopted' });
    expect((await call()).observedCheckout.state).toBe('unregistered');
    expect(broker.snapshot('caller')?.location?.checkoutContextId).toBeNull();
    send('location_changed', { cwd: unknown });
    expect((await call()).observedCheckout).toMatchObject({ state: 'current', matchesLaunch: false, checkout: { branch: 'adopted' } });
  });

  it.skipIf(process.platform === 'win32')('resolves local symlink observations inside the caller workspace', async () => {
    const alias = path.join(root, 'alias'); fs.symlinkSync(taskPath, alias);
    send('session_started', { cwd: toPosixPath(path.join(alias, 'missing-tail')) });
    expect((await call()).observedCheckout).toMatchObject({ state: 'current', checkout: { branch: 'task' } });
  });
});
