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

export interface ActiveAccountFlow { flowId: string; accountId?: string; state: AccountAuthState }

/**
 * Renderer view of one environment+harness account list. All identity, paths and credentials stay in
 * main; this only holds safe projections and an opaque flow ID. A sign-in still pending when the UI
 * goes away is cancelled, so no browser flow or provider process is left behind.
 */
export function useHarnessAccounts(environmentId: string, harness: string, enabled: boolean) {
  const [list, setList] = useState<HarnessAccountList | null>(null);
  const [flow, setFlow] = useState<ActiveAccountFlow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Events can arrive before the start request resolves, so the latest state per flow is buffered.
  const states = useRef(new Map<string, AccountAuthState>());
  const flowRef = useRef<ActiveAccountFlow | null>(null);
  flowRef.current = flow;
  const scope = `${environmentId}\u0000${harness}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const refresh = useCallback(async () => {
    const owner = scopeRef.current;
    try {
      const next = await window.electronAPI.listHarnessAccounts(environmentId, harness);
      if (scopeRef.current === owner) setList(next);
    } catch (reason) {
      if (scopeRef.current === owner) setError(accountErrorMessage(reason));
    }
  }, [environmentId, harness]);

  useEffect(() => {
    if (!enabled) return;
    setList(null);
    setFlow(null);
    setError(null);
    void refresh();
  }, [enabled, refresh]);

  const settle = useCallback((flowId: string, state: AccountAuthState) => {
    states.current.set(flowId, state);
    if (flowRef.current?.flowId !== flowId) return;
    setFlow({ ...flowRef.current, state });
    if (isTerminal(state)) void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    return window.electronAPI.onHarnessAccountAuthState((event) => {
      if (event.environmentId === environmentId && event.harness === harness) settle(event.flowId, event.state);
    });
  }, [enabled, environmentId, harness, settle]);

  useEffect(() => () => {
    const active = flowRef.current;
    if (active && !isTerminal(active.state)) void window.electronAPI.cancelHarnessAccountAuth(active.flowId).catch(() => undefined);
  }, []);

  const run = useCallback(async (action: () => Promise<HarnessAccountList | void>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      if (next) setList(next);
    } catch (reason) {
      setError(accountErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }, []);

  const begin = useCallback(async (start: () => Promise<{ flowId: string; state: AccountAuthState }>, accountId?: string) => {
    setBusy(true);
    setError(null);
    try {
      const started = await start();
      const state = states.current.get(started.flowId) ?? started.state;
      const next: ActiveAccountFlow = { flowId: started.flowId, accountId, state };
      flowRef.current = next;
      setFlow(next);
      if (isTerminal(state)) void refresh();
    } catch (reason) {
      setError(accountErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return {
    list, flow, error, busy,
    select: (accountId: string) => run(() => window.electronAPI.selectHarnessAccount(environmentId, harness, accountId)),
    remove: (accountId: string) => run(() => window.electronAPI.removeHarnessAccount(environmentId, harness, accountId)),
    rename: (accountId: string, label: string) => run(() => window.electronAPI.renameHarnessAccount(environmentId, harness, accountId, label)),
    add: (label?: string) => begin(() => window.electronAPI.startHarnessAccountAdd(environmentId, harness, label || undefined)),
    reconnect: (accountId: string) => begin(() => window.electronAPI.reconnectHarnessAccount(environmentId, harness, accountId), accountId),
    cancel: () => {
      const active = flowRef.current;
      if (active) void window.electronAPI.cancelHarnessAccountAuth(active.flowId).catch(() => undefined);
    },
    dismissFlow: () => setFlow(null),
  };
}
