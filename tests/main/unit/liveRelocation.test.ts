import { describe, expect, it, vi } from 'vitest';
import { LiveCheckoutRelocation, type LiveRelocationRequest } from '../../../src/main/isolatedCheckout/liveRelocation';
import type { AgentAttentionSnapshot } from '../../../src/shared/types/agentAttention';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';

const source: CheckoutContext = { id: 'ws::main', workspaceId: 'ws', environmentId: 'local', kind: 'main', path: '/app' };
const target: CheckoutContext = { ...source, id: 'ws::tree', kind: 'worktree', path: '/app-worktrees/task' };
const snapshot = (overrides: Partial<AgentAttentionSnapshot> = {}): AgentAttentionSnapshot => ({
  terminalId: 'terminal', revision: 1, sessionId: 'native', runtime: { status: 'running', turnId: 'turn', startedAt: 1 },
  pendingRequest: null, lastCompletion: null, lastOutcome: null,
  location: { path: source.path, checkoutContextId: source.id }, ...overrides,
});
function fixture() {
  const gate = new LiveCheckoutRelocation(50);
  const commit = vi.fn(() => true);
  const invoke = vi.fn(async () => undefined);
  const controller = new AbortController();
  const request: LiveRelocationRequest = {
    terminalId: 'terminal', sessionId: 'native', source, target, baseline: snapshot(), signal: controller.signal,
    invoke, commit, isCurrent: () => true,
  };
  const evidence = (overrides: Partial<AgentAttentionSnapshot> = {}, terminalId = 'terminal') => {
    const next = snapshot({ revision: 2, location: { path: target.path + '/src', checkoutContextId: target.id }, ...overrides });
    gate.onAttentionChange({ terminalId, revision: next.revision, snapshot: next });
  };
  return { gate, request, commit, invoke, controller, evidence };
}

describe('live checkout proof gate', () => {
  it('waits for native root proof, not API success, and commits without any replacement or retirement', async () => {
    const f = fixture();
    const moving = f.gate.relocate(f.request);
    await Promise.resolve();
    expect(f.invoke).toHaveBeenCalledOnce();
    expect(f.commit).not.toHaveBeenCalled();
    f.evidence();
    await moving;
    expect(f.commit).toHaveBeenCalledOnce();
    expect(f.invoke.mock.calls[0]).toEqual([expect.objectContaining({ terminalId: 'terminal', sessionId: 'native', source, target })]);
  });

  it('installs the gate before invoking a synchronous native hook', async () => {
    const f = fixture();
    f.request.invoke = async () => { f.evidence(); };
    await f.gate.relocate(f.request);
    expect(f.commit).toHaveBeenCalledOnce();
  });

  it.each(['old revision', 'wrong checkout', 'wrong terminal', 'wrong session', 'new turn', 'ended turn'])(
    'never commits on %s', async (kind) => {
      const f = fixture();
      const moving = f.gate.relocate(f.request);
      const refused = expect(moving).rejects.toThrow();
      if (kind === 'old revision') f.evidence({ revision: 1 });
      if (kind === 'wrong checkout') f.evidence({ location: { path: '/outside', checkoutContextId: null } });
      if (kind === 'wrong terminal') f.evidence({}, 'child-terminal');
      if (kind === 'wrong session') f.evidence({ sessionId: 'child-session' });
      if (kind === 'new turn') f.evidence({ runtime: { status: 'running', turnId: 'other', startedAt: 2 } });
      if (kind === 'ended turn') f.evidence({ runtime: { status: 'idle', turnId: null, startedAt: null } });
      await refused;
      expect(f.commit).not.toHaveBeenCalled();
    },
  );

  it('requires both API settlement and proof; rejects a provider refusal despite location evidence', async () => {
    const f = fixture();
    f.request.invoke = async () => { f.evidence(); throw new Error('native refusal'); };
    await expect(f.gate.relocate(f.request)).rejects.toThrow('native refusal');
    expect(f.commit).not.toHaveBeenCalled();
  });

  it('bounds a hanging native API even after evidence, and cancels its signal', async () => {
    const f = fixture();
    let signal: AbortSignal | undefined;
    f.request.invoke = async (request) => { signal = request.signal; f.evidence(); await new Promise(() => undefined); };
    await expect(f.gate.relocate(f.request)).rejects.toThrow();
    expect(signal?.aborted).toBe(true);
    expect(f.commit).not.toHaveBeenCalled();
  });

  it.each(['abort', 'shutdown', 'workspace mutation', 'commit refusal'])('fails closed on %s', async (kind) => {
    const f = fixture();
    let current = true;
    f.request.isCurrent = () => current;
    const moving = f.gate.relocate(f.request);
    const refused = expect(moving).rejects.toThrow();
    if (kind === 'abort') f.controller.abort();
    if (kind === 'shutdown') f.gate.shutdown();
    if (kind === 'workspace mutation') current = false;
    if (kind === 'commit refusal') f.commit.mockReturnValue(false);
    f.evidence();
    await refused;
    if (kind !== 'commit refusal') expect(f.commit).not.toHaveBeenCalled();
  });

  it('does not treat an arbitrary pre-existing move to the target as pending-transition proof', async () => {
    const f = fixture();
    f.request.baseline = snapshot({ location: { path: target.path, checkoutContextId: target.id } });
    await expect(f.gate.relocate(f.request)).rejects.toThrow();
    expect(f.invoke).not.toHaveBeenCalled();
  });

  it('ignores unsolicited location updates and allows only one pending transition per terminal', async () => {
    const f = fixture();
    f.evidence();
    expect(f.commit).not.toHaveBeenCalled();
    const moving = f.gate.relocate(f.request);
    await expect(f.gate.relocate(f.request)).rejects.toThrow();
    f.evidence();
    await moving;
    expect(f.commit).toHaveBeenCalledOnce();
  });
});
