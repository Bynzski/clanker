import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { GitBranchPlus } from 'lucide-react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { FormMessage } from './ui/Field';
import { Popover, PopoverContent, PopoverTrigger } from './ui/Popover';
import { HARNESS_OPTIONS } from '../lib/harnessOptions';
import { launchIsolatedAgent } from '../lib/isolatedAgentLaunch';
import type { IsolatedAgentTarget } from '../lib/isolatedAgentLaunch';
import { WORKTREE_STATE_LABEL, buildIsolatedAgentChoices } from '../lib/isolatedAgentChoices';
import type { IsolatedAgentChoices } from '../lib/isolatedAgentChoices';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { WorkspaceTab } from '../store/workspaceTypes';
import './IsolatedAgentButton.css';

interface IsolatedAgentButtonProps {
  workspace: Pick<WorkspaceTab, 'id' | 'gitIsRepo' | 'isLinkedWorktree' | 'harness'>;
  visibleHarnessIds: readonly string[];
}

type Destination =
  | { kind: 'new' }
  | { kind: 'branch'; name: string }
  | { kind: 'worktree'; path: string };

const NO_CHOICES: IsolatedAgentChoices = { branches: [], worktrees: [] };

/**
 * One compact toolbar action beside the harness pills: pick a harness and where its agent runs.
 * The pills keep launching straight into the current checkout. This is launch-only; removing,
 * unlocking and pruning worktrees stay in the Git menu. Keyed by workspace by its parent, so its
 * draft and any error never carry over to another workspace.
 */
export default function IsolatedAgentButton({ workspace, visibleHarnessIds }: IsolatedAgentButtonProps) {
  const options = HARNESS_OPTIONS.filter((option) => visibleHarnessIds.includes(option.id));
  const preferred = options.find((option) => option.id === workspace.harness) ?? options[0];
  const [open, setOpen] = useState(false);
  // null until the user picks one, so the default follows the workspace harness as the list loads.
  const [chosenHarnessId, setChosenHarnessId] = useState<string | null>(null);
  const [destination, setDestination] = useState<Destination>({ kind: 'new' });
  const [taskBranch, setTaskBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [choices, setChoices] = useState<IsolatedAgentChoices>(NO_CHOICES);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const requestRef = useRef(0);
  const liveWorkspace = useWorkspaceStore((state) => state.getWorkspaceById(workspace.id));

  // The visible list can load after mount; never submit an id that is not offered.
  const effectiveHarness = options.find((option) => option.id === chosenHarnessId) ?? preferred;
  const effectiveHarnessId = effectiveHarness?.id ?? '';

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
      if (request !== requestRef.current) return;
      if (!branchState.success || !listing.success) {
        setChoices(NO_CHOICES);
        setListError(listing.error || branchState.error || 'Could not read the repository branches and worktrees');
        return;
      }
      const latest = useWorkspaceStore.getState().getWorkspaceById(workspace.id) ?? current;
      setChoices(buildIsolatedAgentChoices({
        workspace: latest,
        branchNames: branchState.branches.map((entry: { name: string }) => entry.name),
        currentBranch: branchState.isDetached ? null : branchState.currentBranch,
        worktrees: listing.worktrees,
      }));
    } catch (cause) {
      if (request !== requestRef.current) return;
      setChoices(NO_CHOICES);
      setListError(cause instanceof Error && cause.message ? cause.message : 'Could not read the repository branches and worktrees');
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [workspace.id]);

  useEffect(() => {
    if (!open) return;
    void loadChoices();
    // A newer load, or closing, makes any in-flight answer stale.
    return () => { requestRef.current += 1; };
  }, [open, loadChoices]);

  // A legacy worktree workspace must not grow nested worktrees; there is nothing to offer a non-repository.
  if (workspace.isLinkedWorktree) return null;
  const available = workspace.gitIsRepo && options.length > 0;
  const title = available ? 'New isolated agent' : 'New isolated agent (requires a Git repository)';

  // Usage changes (a context in use or freed) re-label worktree rows without another Git call.
  const view = liveWorkspace && !listError
    ? rebuildStates(choices, liveWorkspace)
    : choices;

  const handleOpenChange = (next: boolean) => {
    if (busy) return;
    setOpen(next);
    if (next) {
      setError('');
      setDestination({ kind: 'new' });
    }
  };

  const target = (): IsolatedAgentTarget | null => {
    if (destination.kind === 'new') return taskBranch.trim() ? { kind: 'new-branch', branch: taskBranch.trim() } : null;
    if (destination.kind === 'branch') return { kind: 'existing-branch', branch: destination.name };
    return { kind: 'worktree', path: destination.path };
  };
  const pending = target();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !pending) return;
    setBusy(true);
    setError('');
    try {
      const result = await launchIsolatedAgent({ workspaceId: workspace.id, harnessId: effectiveHarnessId, visibleHarnessIds, target: pending });
      if (result.ok) {
        setOpen(false);
        setTaskBranch('');
      } else {
        setError(result.error);
      }
    } finally {
      setBusy(false);
    }
  };

  const launchLabel = busy ? 'Launching…' : `Launch ${effectiveHarness?.label ?? 'agent'}`;

  return (
    <Popover open={open && available} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="harness-pill isolated-agent-trigger"
          aria-label="New isolated agent"
          title={title}
          disabled={!available}
        >
          <GitBranchPlus size={14} strokeWidth={2.25} />
          {/* Same responsive rule as the harness labels: spelled out only on a wide toolbar. */}
          <span className="harness-pill-label" aria-hidden="true">Isolated</span>
        </button>
      </PopoverTrigger>
      <PopoverContent workspaceId={workspace.id} align="start" className="isolated-agent-popover">
        <form className="isolated-agent-form" onSubmit={(event) => void submit(event)}>
          <div className="isolated-agent-panes">
            <div className="isolated-agent-pane isolated-agent-harnesses" role="radiogroup" aria-label="Harness">
              <div className="isolated-agent-heading">Harness</div>
              {options.map((option) => {
                const IconComponent = option.Icon;
                const selected = option.id === effectiveHarnessId;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`isolated-agent-choice${selected ? ' selected' : ''}`}
                    disabled={busy}
                    title={option.label}
                    onClick={() => setChosenHarnessId(option.id)}
                  >
                    <IconComponent size={14} strokeWidth={2.25} />
                    <span className="isolated-agent-choice-label">{option.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="isolated-agent-pane isolated-agent-copies" role="group" aria-label="Working copy">
              <div className="isolated-agent-heading">Working copy</div>

              <div className={`isolated-agent-new${destination.kind === 'new' ? ' selected' : ''}`}>
                <label className="isolated-agent-subheading" htmlFor="isolated-agent-branch">New branch</label>
                <Input
                  id="isolated-agent-branch"
                  value={taskBranch}
                  disabled={busy}
                  placeholder="issue-123-fix-login"
                  autoComplete="off"
                  spellCheck={false}
                  onFocus={() => setDestination({ kind: 'new' })}
                  onChange={(event) => { setTaskBranch(event.target.value); setDestination({ kind: 'new' }); }}
                />
              </div>

              <div className="isolated-agent-scroll">
                {listError && <div className="isolated-agent-note" role="status">{listError}</div>}
                {loading && choices === NO_CHOICES && <div className="isolated-agent-note">Loading…</div>}

                {view.branches.length > 0 && (
                  <div className="isolated-agent-section" role="group" aria-label="Existing branches">
                    <div className="isolated-agent-subheading">Existing branches</div>
                    {view.branches.map((name) => {
                      const selected = destination.kind === 'branch' && destination.name === name;
                      return (
                        <button
                          key={name}
                          type="button"
                          aria-pressed={selected}
                          className={`isolated-agent-choice${selected ? ' selected' : ''}`}
                          disabled={busy}
                          title={`Create a worktree for ${name}`}
                          onClick={() => setDestination({ kind: 'branch', name })}
                        >
                          <span className="isolated-agent-choice-label">{name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {view.worktrees.length > 0 && (
                  <div className="isolated-agent-section" role="group" aria-label="Existing worktrees">
                    <div className="isolated-agent-subheading">Existing worktrees</div>
                    {view.worktrees.map((entry) => {
                      const selected = destination.kind === 'worktree' && destination.path === entry.path;
                      const stateLabel = WORKTREE_STATE_LABEL[entry.state];
                      return (
                        <button
                          key={entry.path}
                          type="button"
                          aria-pressed={selected}
                          className={`isolated-agent-choice${selected ? ' selected' : ''}`}
                          disabled={busy || entry.disabled}
                          title={entry.disabled
                            ? `${entry.path}\n${entry.state === 'missing' ? 'Missing: prune it from the Git menu' : 'Locked: unlock it from the Git menu'}`
                            : entry.path}
                          onClick={() => setDestination({ kind: 'worktree', path: entry.path })}
                        >
                          <span className="isolated-agent-choice-label">{entry.label}</span>
                          <span className={`isolated-agent-state ${entry.state}`}>{stateLabel}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {error && <FormMessage variant="error" role="alert">{error}</FormMessage>}
          <Button type="submit" size="sm" variant="primary" disabled={busy || !pending || !effectiveHarness}>
            {launchLabel}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** Re-derive each worktree row's state from the live store so usage changes show without a reload. */
function rebuildStates(choices: IsolatedAgentChoices, workspace: WorkspaceTab): IsolatedAgentChoices {
  if (choices.worktrees.length === 0) return choices;
  return {
    branches: choices.branches,
    worktrees: choices.worktrees.map((entry) => {
      if (entry.state === 'missing' || entry.state === 'locked') return entry;
      const managed = (workspace.checkoutContexts ?? []).find((context) => context.id === entry.managed?.id) ?? null;
      if (!managed) return entry.managed ? { ...entry, managed: null, state: 'unmanaged' as const } : entry;
      return { ...entry, state: workspace.terminals.some((terminal) => terminal.checkoutContextId === managed.id) ? 'in-use' as const : 'available' as const };
    }),
  };
}
