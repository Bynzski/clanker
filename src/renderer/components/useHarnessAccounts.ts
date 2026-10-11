import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountAuthState, HarnessAccountList } from '../../shared/types/harnessAccounts';

/** IPC rejections arrive as "Error invoking remote method '…': Error: <safe message>". */
export function accountErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : '';
  const message = text.split('Error: ').pop()?.trim();
  return message || 'The account operation failed.';
}

const isTerminal = (state: AccountAuthState | undefined) =>
  state?.status === 'connected' || state?.status === 'failed' || state?.status === 'cancelled';

export interface ActiveAccountFlow { flowId: string; accountId?: string; state: AccountAuthState; scope: string }

/**
 * Renderer view of one environment+harness account list. All identity, paths and credentials stay in
 * main; this only holds safe projections and an opaque flow ID. A flow remembers the scope that created
 * it: when the scope changes (or the UI goes away) a nonterminal flow is cancelled before anything
 * from the new scope is shown, and events or results belonging to an old scope are ignored.
 */
export function useHarnessAccounts(environmentId: string, harness: string, enabled: boolean) {
  const scope = `${environmentId}\u0000${harness}`;
  const [list, setList] = useState<HarnessAccountList | null>(null);
  const [flow, setFlow] = useState<ActiveAccountFlow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Events can arrive before the start request resolves, so the latest state per flow is buffered.
  const states = useRef(new Map<string, AccountAuthState>());
  const cancelled = useRef(new Set<string>());
  const flowRef = useRef<ActiveAccountFlow | null>(null);
  const lifetime = useRef<object | null>(null);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  /** Idempotent, and never for a flow that already reached a terminal state. */
  const cancelFlow = useCallback((active: ActiveAccountFlow | null) => {
    if (!active || isTerminal(active.state) || isTerminal(states.current.get(active.flowId)) || cancelled.current.has(active.flowId)) return;
    cancelled.current.add(active.flowId);
    void window.electronAPI.cancelHarnessAccountAuth(active.flowId).catch(() => undefined);
  }, []);

  const refresh = useCallback(async () => {
    const owner = lifetime.current;
    const ownerScope = scopeRef.current;
    if (!owner) return;
    setError(null);
    try {
      const next = await window.electronAPI.listHarnessAccounts(environmentId, harness);
      if (lifetime.current === owner && scopeRef.current === ownerScope) setList(next);
    } catch (reason) {
      if (lifetime.current === owner && scopeRef.current === ownerScope) setError(accountErrorMessage(reason));
    }
  }, [environmentId, harness]);

  // The effect that owns a scope also owns its cleanup: switching scope, disabling and unmounting all
  // cancel the old scope's pending flow here, before the new scope's list is requested.
  useEffect(() => {
    if (!enabled) return;
    const owner = {};
    lifetime.current = owner;
    setList(null);
    setFlow(null);
    setError(null);
    setBusy(false);
    flowRef.current = null;
    void refresh();
    return () => {
      if (lifetime.current === owner) lifetime.current = null;
      cancelFlow(flowRef.current);
      flowRef.current = null;
    };
  }, [enabled, refresh, cancelFlow]);

  const settle = useCallback((flowId: string, state: AccountAuthState) => {
    states.current.set(flowId, state);
    const active = flowRef.current;
    if (!active || active.flowId !== flowId || active.scope !== scopeRef.current) return;
    const next = { ...active, state };
    flowRef.current = next;
    setFlow(next);
    if (isTerminal(state)) void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    return window.electronAPI.onHarnessAccountAuthState((event) => {
      if (event.environmentId === environmentId && event.harness === harness) settle(event.flowId, event.state);
    });
  }, [enabled, environmentId, harness, settle]);

  const run = useCallback(async (action: () => Promise<HarnessAccountList | void>) => {
    const owner = lifetime.current;
    const ownerScope = scopeRef.current;
    if (!owner) return;
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      if (next && lifetime.current === owner && scopeRef.current === ownerScope) setList(next);
    } catch (reason) {
      if (lifetime.current === owner && scopeRef.current === ownerScope) setError(accountErrorMessage(reason));
    } finally {
      if (lifetime.current === owner && scopeRef.current === ownerScope) setBusy(false);
    }
  }, []);

  const begin = useCallback(async (start: () => Promise<{ flowId: string; state: AccountAuthState }>, accountId?: string) => {
    const owner = lifetime.current;
    const ownerScope = scopeRef.current;
    if (!owner) return;
    setBusy(true);
    setError(null);
    try {
      const started = await start();
      const state = states.current.get(started.flowId) ?? started.state;
      const next: ActiveAccountFlow = { flowId: started.flowId, accountId, state, scope: ownerScope };
      if (lifetime.current !== owner || scopeRef.current !== ownerScope) { cancelFlow(next); return; } // the scope changed while starting
      flowRef.current = next;
      setFlow(next);
      if (isTerminal(state)) void refresh();
    } catch (reason) {
      if (lifetime.current === owner && scopeRef.current === ownerScope) setError(accountErrorMessage(reason));
    } finally {
      if (lifetime.current === owner && scopeRef.current === ownerScope) setBusy(false);
    }
  }, [refresh, cancelFlow]);

  // Never expose state that belongs to a previous scope, even for the render before effects run.
  const visibleList = list && list.environmentId === environmentId && list.harness === harness ? list : null;
  const visibleFlow = flow && flow.scope === scope ? flow : null;

  return {
    list: visibleList, flow: visibleFlow, error, busy, refresh,
    select: (accountId: string) => run(() => window.electronAPI.selectHarnessAccount(environmentId, harness, accountId)),
    remove: (accountId: string) => run(() => window.electronAPI.removeHarnessAccount(environmentId, harness, accountId)),
    rename: (accountId: string, label: string) => run(() => window.electronAPI.renameHarnessAccount(environmentId, harness, accountId, label)),
    add: (label?: string) => begin(() => window.electronAPI.startHarnessAccountAdd(environmentId, harness, label || undefined)),
    reconnect: (accountId: string) => begin(() => window.electronAPI.reconnectHarnessAccount(environmentId, harness, accountId), accountId),
    cancel: () => cancelFlow(flowRef.current),
    dismissFlow: () => { flowRef.current = null; setFlow(null); },
  };
}
