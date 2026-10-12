import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { useCheckoutOccupancy, isCheckoutContextInUse } from '../lib/worktreeAgents';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { FormMessage } from './ui/Field';
import { Popover, PopoverContent, PopoverTrigger } from './ui/Popover';
import { HARNESS_OPTIONS } from '../lib/harnessOptions';
import { launchSession } from '../lib/sessionLaunch';
import type { SessionLaunchTarget } from '../lib/sessionLaunch';
import { WORKTREE_STATE_LABEL, buildSessionLaunchChoices } from '../lib/sessionLaunchChoices';
import type { SessionLaunchChoices } from '../lib/sessionLaunchChoices';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { WorkspaceTab } from '../store/workspaceTypes';
import { isWorktreeRemovalWorkspaceCurrent } from '../lib/worktreeRemovalScope';
import './NewSessionButton.css';

interface NewSessionButtonProps {
  workspace: Pick<WorkspaceTab, 'id' | 'gitIsRepo' | 'isLinkedWorktree' | 'harness'>;
  visibleHarnessIds: readonly string[];
  /** Source Control reuses this form for manual creation, without offering session launch. */
  creationOnly?: boolean;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCreated?: () => void;
}
type Destination = { kind: 'main' } | { kind: 'new' } | { kind: 'branch'; name: string } | { kind: 'worktree'; path: string; branch: string | null };
const NO_CHOICES: SessionLaunchChoices = { branches: [], worktrees: [] };

/** Explicit new-session targets are independent of agent observations and editor pins. */
export default function NewSessionButton({ workspace, visibleHarnessIds, creationOnly = false, disabled, onOpenChange, onCreated }: NewSessionButtonProps) {
  useCheckoutOccupancy();
  const options = HARNESS_OPTIONS.filter((option) => !option.id || visibleHarnessIds.includes(option.id));
  const preferred = options.find((option) => option.id === workspace.harness) ?? options[0];
  const [open, setOpen] = useState(false);
  const [chosenHarnessId, setChosenHarnessId] = useState<string | null>(null);
  const [destination, setDestination] = useState<Destination>({ kind: 'main' });
  const [taskBranch, setTaskBranch] = useState('');
  const [basePath, setBasePath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [choices, setChoices] = useState<SessionLaunchChoices>(NO_CHOICES);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const requestRef = useRef(0);
  const liveWorkspace = useWorkspaceStore((state) => state.getWorkspaceById(workspace.id));
  const effectiveHarness = options.find((option) => option.id === chosenHarnessId) ?? preferred;
  const worktreesEnabled = workspace.gitIsRepo && !workspace.isLinkedWorktree;

  useEffect(() => {
    onOpenChange?.(open);
    return () => onOpenChange?.(false);
  }, [open, onOpenChange]);

  const loadChoices = useCallback(async () => {
    const current = useWorkspaceStore.getState().getWorkspaceById(workspace.id);
    if (!current) return;
    const request = ++requestRef.current;
    setLoading(true);
    setListError('');
    try {
      const [branchState, listing] = await Promise.all([
        window.electronAPI.gitGetBranchState(current.workspacePath, current.id),
        window.electronAPI.gitListWorktrees(current.workspacePath, current.id),
      ]);
      if (request !== requestRef.current || !isWorktreeRemovalWorkspaceCurrent(current)) return;
      if (!branchState.success || !listing.success) {
        setChoices(NO_CHOICES);
        setListError(listing.error || branchState.error || 'Could not read branches and worktrees. Main checkout is still available.');
        return;
      }
      setChoices(buildSessionLaunchChoices({
        workspace: useWorkspaceStore.getState().getWorkspaceById(workspace.id)!,
        branchNames: branchState.branches.map((entry: { name: string }) => entry.name),
        currentBranch: branchState.isDetached ? null : branchState.currentBranch,
        worktrees: listing.worktrees,
      }));
    } catch (cause) {
      if (request !== requestRef.current) return;
      setChoices(NO_CHOICES);
      setListError(cause instanceof Error ? cause.message : 'Could not read branches and worktrees');
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [workspace.id]);

  useEffect(() => {
    if (!open || !worktreesEnabled) return;
    void loadChoices();
    return () => { requestRef.current += 1; };
  }, [open, worktreesEnabled, loadChoices]);

  const view = liveWorkspace && !listError ? rebuildStates(choices, liveWorkspace) : choices;
  const handleOpenChange = (next: boolean) => {
    if (busy) return;
    setOpen(next);
    if (next) {
      setError('');
      setDestination({ kind: creationOnly ? 'new' : 'main' });
      setTaskBranch('');
      setBasePath('');
      setChoices(NO_CHOICES);
    }
  };
  const target = (): SessionLaunchTarget | null => {
    if (destination.kind === 'main') return { kind: 'main' };
    if (destination.kind === 'new') {
      const base = basePath ? view.worktrees.find((entry) => entry.path === basePath && !entry.disabled) : null;
      if (!taskBranch.trim() || (basePath && !base)) return null;
      return { kind: 'new-branch', branch: taskBranch.trim(), ...(base ? { baseWorktree: { path: base.path, branch: base.branch } } : {}) };
    }
    if (destination.kind === 'branch') return { kind: 'existing-branch', branch: destination.name };
    return { kind: 'worktree', path: destination.path, expectedBranch: destination.branch };
  };
  const pending = target();
  const submit = async (event: FormEvent | null, createOnly = false) => {
    event?.preventDefault();
    if (busy || !pending) return;
    setBusy(true);
    setError('');
    try {
      const result = await launchSession({ workspaceId: workspace.id, harnessId: effectiveHarness.id, visibleHarnessIds, target: pending, createOnly: creationOnly || createOnly });
      if (result.ok) { setOpen(false); if (creationOnly || createOnly) onCreated?.(); }
      else setError(result.error);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start the session');
    } finally { setBusy(false); }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button type="button" className="new-session-trigger" disabled={disabled} aria-label={creationOnly ? 'Create worktree' : 'New Session'} title={creationOnly ? 'Create worktree' : 'New Session'}>
          <Plus size={14} strokeWidth={2.25} /><span className="new-session-label">{creationOnly ? 'Create worktree…' : 'New Session'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent workspaceId={workspace.id} align="start" className={`new-session-popover${creationOnly ? ' new-session-create-only' : ''}`} aria-label={creationOnly ? 'Create worktree' : 'New Session'}>
        <form className="new-session-form" onSubmit={(event) => void submit(event)}>
          <div className="new-session-panes">
            {!creationOnly && <div className="new-session-pane new-session-harnesses" role="radiogroup" aria-label="Harness">
              <div className="new-session-heading">Harness</div>
              {options.map((option) => {
                const Icon = option.Icon;
                return <button key={option.id} type="button" role="radio" aria-checked={option.id === effectiveHarness.id}
                  className={`new-session-choice${option.id === effectiveHarness.id ? ' selected' : ''}`} disabled={busy} title={option.label} onClick={() => setChosenHarnessId(option.id)}>
                  <Icon size={14} strokeWidth={2.25} /><span className="new-session-choice-label">{option.label}</span>
                </button>;
              })}
            </div>}
            <div className="new-session-pane new-session-copies" role="group" aria-label="Working copy">
              <div className="new-session-heading">Working copy</div>
              {!creationOnly && <button type="button" aria-pressed={destination.kind === 'main'} className={`new-session-choice${destination.kind === 'main' ? ' selected' : ''}`} disabled={busy} onClick={() => setDestination({ kind: 'main' })}>Main checkout</button>}
              {worktreesEnabled ? <>
                <div className={`new-session-new${destination.kind === 'new' ? ' selected' : ''}`}>
                  <label className="new-session-subheading" htmlFor="new-session-branch">New branch</label>
                  <Input id="new-session-branch" value={taskBranch} disabled={busy} placeholder="issue-123-fix-login" autoComplete="off" spellCheck={false}
                    onFocus={() => setDestination({ kind: 'new' })} onChange={(event) => { setTaskBranch(event.target.value); setDestination({ kind: 'new' }); }} />
                  <label className="new-session-subheading" htmlFor="new-session-base">Start from committed HEAD</label>
                  <Select id="new-session-base" value={basePath} disabled={busy} onChange={(event) => { setBasePath(event.target.value); setDestination({ kind: 'new' }); }}>
                    <option value="">Main checkout</option>
                    {view.worktrees.filter((entry) => !entry.disabled).map((entry) => <option key={entry.path} value={entry.path}>{entry.label}</option>)}
                  </Select>
                  <div className="new-session-note">Creates a new worktree. Uncommitted changes stay in the source checkout.</div>
                </div>
                <div className="new-session-scroll">
                  {listError && <div className="new-session-note" role="status">{listError}</div>}
                  {loading && choices === NO_CHOICES && <div className="new-session-note">Loading…</div>}
                  {view.branches.length > 0 && <div className="new-session-section" role="group" aria-label="Existing branches">
                    <div className="new-session-subheading">New worktree for existing branch</div>
                    {view.branches.map((name) => <button key={name} type="button" aria-pressed={destination.kind === 'branch' && destination.name === name}
                      className={`new-session-choice${destination.kind === 'branch' && destination.name === name ? ' selected' : ''}`} disabled={busy} title={`Create a worktree for ${name}`} onClick={() => setDestination({ kind: 'branch', name })}>
                      <span className="new-session-choice-label">{name}</span>
                    </button>)}
                  </div>}
                  {!creationOnly && view.worktrees.length > 0 && <div className="new-session-section" role="group" aria-label="Existing worktrees">
                    <div className="new-session-subheading">Existing worktrees</div>
                    {view.worktrees.map((entry) => <button key={entry.path} type="button" aria-pressed={destination.kind === 'worktree' && destination.path === entry.path}
                      className={`new-session-choice${destination.kind === 'worktree' && destination.path === entry.path ? ' selected' : ''}`} disabled={busy || entry.disabled}
                      title={entry.disabled ? `${entry.path}\n${WORKTREE_STATE_LABEL[entry.state]}: manage in Source Control → Worktrees` : entry.path}
                      onClick={() => setDestination({ kind: 'worktree', path: entry.path, branch: entry.branch })}>
                      <span className="new-session-choice-label">{entry.label}</span><span className={`new-session-state ${entry.state}`}>{WORKTREE_STATE_LABEL[entry.state]}</span>
                    </button>)}
                  </div>}
                </div>
              </> : <div className="new-session-note">{workspace.isLinkedWorktree ? 'This project is already a linked worktree. New sessions use its registered root.' : 'Worktree destinations require a Git repository.'}</div>}
            </div>
          </div>
          {error && <FormMessage variant="error" role="alert">{error}</FormMessage>}
          <div className="new-session-actions">
            <Button type="submit" size="sm" variant="primary" disabled={busy || !pending}>{busy ? 'Working…' : creationOnly ? 'Create worktree' : `Launch ${effectiveHarness.label}`}</Button>
            {!creationOnly && <Button type="button" size="sm" variant="ghost" disabled={busy || !pending || pending.kind === 'worktree' || pending.kind === 'main'} onClick={() => void submit(null, true)}>Create worktree only</Button>}
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function rebuildStates(choices: SessionLaunchChoices, workspace: WorkspaceTab): SessionLaunchChoices {
  return { ...choices, worktrees: choices.worktrees.map((entry) => {
    if (entry.state === 'missing' || entry.state === 'locked') return entry;
    const managed = (workspace.checkoutContexts ?? []).find((context) => context.id === entry.managed?.id) ?? null;
    return { ...entry, managed, state: isCheckoutContextInUse(workspace, managed ?? { id: '', path: entry.path }) ? 'in-use' : 'available' };
  }) };
}
