import { useEffect, useRef, useState } from 'react';
import type { ObservedWorktreeResult } from '../../shared/types/observedWorktree';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useAgentAttentionStore } from '../store/agentAttentionStore';
import { useAgentSnapshot } from '../lib/useAgentLocation';
import { useAssistantNavStore } from '../store/assistantNavStore';
import ConfirmCloseDialog from './ConfirmCloseDialog';
import { Button } from './ui/Button';
import './ObservedWorktreeNotice.css';

function observationKey(workspaceId: string): string | null {
  const workspace = useWorkspaceStore.getState().getWorkspaceById(workspaceId);
  const terminalId = workspace?.activeTerminalId;
  const snapshot = terminalId ? useAgentAttentionStore.getState().byTerminalId[terminalId] : null;
  if (!workspace || !terminalId || !snapshot?.location || snapshot.locationProvenance?.state !== 'current') return null;
  return JSON.stringify([workspaceId, workspace.environmentId, workspace.workspacePath, terminalId,
    snapshot.location.path, snapshot.location.checkoutContextId, snapshot.locationProvenance]);
}

/** Active surface only. Discovery grants nothing; confirmation re-derives the target in main.
 * Ordinary lifecycle revisions at one location do not spawn extra Git/SSH probes. */
export default function ObservedWorktreeNotice({ workspaceId }: { workspaceId: string }) {
  const workspace = useWorkspaceStore(state => state.getWorkspaceById(workspaceId));
  useAgentSnapshot(workspace?.activeTerminalId);
  const key = observationKey(workspaceId);
  const [result, setResult] = useState<ObservedWorktreeResult | null>(null);
  const [resultKey, setResultKey] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [browsing, setBrowsing] = useState<string | null>(null);
  const generation = useRef(0);
  const autoRetries = useRef({ key: null as string | null, count: 0 });
  const pin = workspace?.fileSurfaceContextId;
  // Invalidate immediately, including batched A→B→A focus changes before React effects run.
  useEffect(() => {
    const viewKey = () => {
      const ws = useWorkspaceStore.getState().getWorkspaceById(workspaceId);
      return JSON.stringify([observationKey(workspaceId), useWorkspaceStore.getState().activeWorkspaceId,
        useAssistantNavStore.getState().activeAssistantId, ws?.fileSurfaceContextId, ws?.activePageId]);
    };
    let previous = viewKey();
    const changed = () => {
      const next = viewKey();
      if (next === previous) return;
      previous = next; generation.current++; setResult(null); setConfirming(false); setBusy(false); setRetry(value => value + 1);
    };
    const stops = [useWorkspaceStore.subscribe(changed), useAgentAttentionStore.subscribe(changed), useAssistantNavStore.subscribe(changed)];
    return () => stops.forEach(stop => stop());
  }, [workspaceId]);
  useEffect(() => {
    const epoch = ++generation.current;
    let live = true;
    const current = () => live && generation.current === epoch && observationKey(workspaceId) === key
      && useWorkspaceStore.getState().activeWorkspaceId === workspaceId && !useAssistantNavStore.getState().activeAssistantId;
    if (autoRetries.current.key !== key) autoRetries.current = { key, count: 0 };
    const timer = window.setTimeout(() => {
      if (!current()) return;
      setResult(null); setResultKey(key); setConfirming(false); setBusy(false);
      const ws = useWorkspaceStore.getState().getWorkspaceById(workspaceId);
      const terminalId = ws?.activeTerminalId;
      const now = terminalId ? useAgentAttentionStore.getState().byTerminalId[terminalId] : null;
      const recorded = ws?.checkoutContexts?.find(context => context.id === now?.location?.checkoutContextId);
      if (!key || !terminalId || !now || ws?.fileSurfaceContextId || (recorded && !recorded.missing && recorded.path === now.location?.path)) return;
      void window.electronAPI.inspectObservedWorktree(terminalId, now.revision).then(value => {
        if (!current()) return;
        // A lifecycle-only revision can race an SSH lookup at the same physical location.
        // Retry at most twice; never poll indefinitely or silently grant a stale candidate.
        if (!value.success && useAgentAttentionStore.getState().byTerminalId[terminalId]?.revision !== now.revision
          && autoRetries.current.count < 2) {
          autoRetries.current.count++; setRetry(value => value + 1); return;
        }
        setResult(value);
      }).catch(() => { if (current()) setResult({ success: false, error: 'Could not inspect the agent checkout' }); });
    }, 350);
    const retire = () => { generation.current++; };
    return () => { live = false; retire(); window.clearTimeout(timer); };
  }, [workspaceId, key, retry, pin]);

  useEffect(() => { if (browsing && pin !== browsing) setBrowsing(null); }, [browsing, pin]);
  const candidate = result?.candidate;
  const attach = async () => {
    const terminalId = workspace?.activeTerminalId;
    const now = terminalId ? useAgentAttentionStore.getState().byTerminalId[terminalId] : null;
    if (!terminalId || !now || !candidate || resultKey !== key || observationKey(workspaceId) !== key
      || useWorkspaceStore.getState().activeWorkspaceId !== workspaceId || useAssistantNavStore.getState().activeAssistantId
      || useWorkspaceStore.getState().getWorkspaceById(workspaceId)?.fileSurfaceContextId !== pin) return;
    const epoch = generation.current;
    setConfirming(false); setBusy(true);
    try {
      const attached = await window.electronAPI.attachObservedWorktree(terminalId, now.revision, { path: candidate.path, branch: candidate.branch });
      if (generation.current !== epoch || observationKey(workspaceId) !== key
        || useWorkspaceStore.getState().activeWorkspaceId !== workspaceId || useAssistantNavStore.getState().activeAssistantId
        || useWorkspaceStore.getState().getWorkspaceById(workspaceId)?.fileSurfaceContextId !== pin) return;
      const store = useWorkspaceStore.getState();
      if (!attached.success || !attached.checkoutContext) { setResult(attached); return; }
      if (!store.upsertCheckoutContext(workspaceId, attached.checkoutContext)
        || !useWorkspaceStore.getState().pinFileCheckout(workspaceId, attached.checkoutContext.id)) {
        setResult({ success: false, error: 'The checkout changed; refresh before browsing' }); return;
      }
      setBrowsing(attached.checkoutContext.id);
    } catch { if (generation.current === epoch) setResult({ success: false, error: 'Could not attach the worktree; retry discovery' }); }
    finally { if (generation.current === epoch) setBusy(false); }
  };

  if (browsing && pin === browsing) return <div className="observed-worktree-notice" role="status">
    <span>Browsing attached checkout · agent launch unchanged</span>
    <Button size="xs" variant="ghost" onClick={() => { useWorkspaceStore.getState().pinFileCheckout(workspaceId, null); setBrowsing(null); }}>Follow agent</Button>
  </div>;
  if (!key || pin || dismissed === key || !result || (resultKey !== key) || (!candidate && result.success)) return null;
  return <div className="observed-worktree-notice" role="status">
    <span>{candidate ? `Agent reported Git worktree ${candidate.branch || 'HEAD'} · ${candidate.path}` : result.error}
      {candidate?.locked && ` · Locked${candidate.lockReason ? `: ${candidate.lockReason}` : ''}. Clanker will not unlock it automatically.`}</span>
    {candidate && !candidate.locked && <Button size="xs" variant="secondary" disabled={busy} onClick={() => setConfirming(true)}>Attach and browse…</Button>}
    <Button size="xs" variant="ghost" disabled={busy} onClick={() => { autoRetries.current.count = 0; setRetry(value => value + 1); }}>Retry discovery</Button>
    <Button size="xs" variant="ghost" onClick={() => setDismissed(key)}>Dismiss</Button>
    <ConfirmCloseDialog isOpen={confirming} title="Attach observed worktree?"
      message={`Allow Files and Source Control to use ${candidate?.path}? Clanker will verify the repository again. This does not move or restart the agent, unlock the worktree, or change its launch checkout.`}
      options={[{ label: 'Attach and browse', variant: 'primary', action: () => { void attach(); } }]} onCancel={() => setConfirming(false)} />
  </div>;
}
