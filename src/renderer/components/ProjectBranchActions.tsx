import { useRef, useState } from 'react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { FormMessage } from './ui/Field';
import { selectFocusedWorkspace, useWorkspaceStore } from '../store/workspaceStore';
import type { WorkspaceTab } from '../store/workspaceTypes';
import { isWorktreeRemovalWorkspaceCurrent } from '../lib/worktreeRemovalScope';

interface Props {
  workspace: WorkspaceTab;
  currentBranch: string | null;
  branches: readonly string[];
  occupiedBranches: readonly string[];
  disabled: boolean;
  onEditingChange: (editing: boolean) => void;
  onChanged: () => Promise<void>;
}

/** Branch changes are explicit folder operations, never a side effect of launching an agent. */
export function ProjectBranchActions({ workspace, currentBranch, branches, occupiedBranches, disabled, onEditingChange, onChanged }: Props) {
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState('switch');
  const [branch, setBranch] = useState('');
  const [base, setBase] = useState('');
  const [name, setName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const changeEditing = (next: boolean) => {
    setEditing(next); onEditingChange(next); setConfirmed(false); setError('');
    if (next) { setMode('switch'); setBranch(''); setBase(''); setName(''); }
  };
  const isCurrent = () => isWorktreeRemovalWorkspaceCurrent(workspace)
    && selectFocusedWorkspace(useWorkspaceStore.getState())?.id === workspace.id;
  const apply = async () => {
    if (pending.current || disabled || !confirmed || !isCurrent()) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const fresh = await window.electronAPI.gitGetBranchState(workspace.workspacePath, workspace.id);
      if (!isCurrent()) return;
      if (!fresh.success || !fresh.isRepo) throw new Error(fresh.error || 'Could not read the current branch');
      if (fresh.currentBranch !== currentBranch) throw new Error('The folder’s branch changed. Cancel and reopen the picker to refresh it.');
      const source = mode === 'switch' ? branch : base;
      if (source && !fresh.branches.some((entry) => entry.name === source)) throw new Error('That branch no longer exists. Reopen the picker to refresh it.');
      if (mode === 'switch' && !branch) return;
      if (mode === 'create' && !name.trim()) return;
      const result = mode === 'switch'
        ? await window.electronAPI.gitSwitchBranch(workspace.workspacePath, branch, workspace.id)
        : await window.electronAPI.gitCreateBranch(workspace.workspacePath, name.trim(), base ? `refs/heads/${base}` : undefined, workspace.id);
      if (!isCurrent()) return;
      if (!result.success) throw new Error(result.error || 'Could not change branch');
      await onChanged();
      if (isCurrent()) changeEditing(false);
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : 'Could not change branch');
    } finally { pending.current = false; setBusy(false); }
  };

  if (!editing) return <Button type="button" size="xs" variant="ghost" disabled={disabled} onClick={() => changeEditing(true)}>Change branch…</Button>;
  return <div className="new-session-branch-actions" role="group" aria-label="Change project folder branch">
    <Select aria-label="Branch action" value={mode} disabled={busy} onChange={(event) => { setMode(event.target.value); setConfirmed(false); }}>
      <option value="switch">Switch branch in this folder</option>
      <option value="create">Create a branch in this folder</option>
    </Select>
    {mode === 'switch' ? <Select aria-label="Switch to branch" value={branch} disabled={busy} onChange={(event) => { setBranch(event.target.value); setConfirmed(false); }}>
      <option value="">Choose a branch</option>
      {branches.map((entry) => <option key={entry} value={entry} disabled={entry === currentBranch || occupiedBranches.includes(entry)}>{entry}{entry === currentBranch ? ' · current' : occupiedBranches.includes(entry) ? ' · open in another folder' : ''}</option>)}
    </Select> : <>
      <label className="new-session-subheading" htmlFor="project-new-branch">Branch name</label>
      <Input id="project-new-branch" value={name} placeholder="experiment/my-idea" autoComplete="off" spellCheck={false} disabled={busy} onChange={(event) => { setName(event.target.value); setConfirmed(false); }} />
      <label className="new-session-subheading" htmlFor="project-branch-base">Start from</label>
      <Select id="project-branch-base" value={base} disabled={busy} onChange={(event) => { setBase(event.target.value); setConfirmed(false); }}>
        <option value="">Current commit{currentBranch ? ` · ${currentBranch}` : ''}</option>
        {branches.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
      </Select>
    </>}
    <p className="new-session-note">Changes this folder for every agent, terminal and dev server using it. Commit or stash changes first. Branches open elsewhere can be used from the existing folders list.</p>
    <label className="new-session-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} /> I’m ready to change this folder’s branch.</label>
    {error && <FormMessage variant="error" role="alert">{error}</FormMessage>}
    <div className="new-session-actions">
      <Button type="button" size="sm" disabled={busy || disabled || !confirmed || (mode === 'switch' ? !branch : !name.trim())} onClick={() => void apply()}>{busy ? 'Changing…' : mode === 'switch' ? 'Switch branch' : 'Create and switch'}</Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => changeEditing(false)}>Cancel</Button>
    </div>
  </div>;
}
