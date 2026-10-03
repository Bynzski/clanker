import { useState } from 'react';
import type { FormEvent } from 'react';
import { GitBranch } from 'lucide-react';
import { IconButton } from './ui/IconButton';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { Field, FieldLabel, FormMessage } from './ui/Field';
import { Popover, PopoverContent, PopoverTrigger } from './ui/Popover';
import { HARNESS_OPTIONS } from '../lib/harnessOptions';
import { createIsolatedAgent } from '../lib/isolatedAgentLaunch';
import type { WorkspaceTab } from '../store/workspaceTypes';
import './IsolatedAgentButton.css';

interface IsolatedAgentButtonProps {
  workspace: Pick<WorkspaceTab, 'id' | 'gitIsRepo' | 'isLinkedWorktree' | 'harness'>;
  visibleHarnessIds: readonly string[];
}

/**
 * One compact toolbar action beside the harness pills. The pills keep launching straight into the
 * current checkout; this is the only path that creates a worktree. Keyed by workspace by its parent,
 * so its draft and any error never carry over to another workspace.
 */
export default function IsolatedAgentButton({ workspace, visibleHarnessIds }: IsolatedAgentButtonProps) {
  const options = HARNESS_OPTIONS.filter((option) => visibleHarnessIds.includes(option.id));
  const preferred = options.find((option) => option.id === workspace.harness) ?? options[0];
  const [open, setOpen] = useState(false);
  // null until the user picks one, so the default follows the workspace harness as the list loads.
  const [chosenHarnessId, setChosenHarnessId] = useState<string | null>(null);
  const [taskBranch, setTaskBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // The visible list can load after mount; never submit an id that is not offered.
  const effectiveHarnessId = chosenHarnessId !== null && options.some((option) => option.id === chosenHarnessId)
    ? chosenHarnessId
    : (preferred?.id ?? '');

  // A legacy worktree workspace must not grow nested worktrees; there is nothing to offer a non-repository.
  if (workspace.isLinkedWorktree) return null;
  const available = workspace.gitIsRepo && options.length > 0;
  const title = available ? 'New isolated agent' : 'New isolated agent (requires a Git repository)';

  const handleOpenChange = (next: boolean) => {
    if (busy) return;
    setOpen(next);
    if (next) setError('');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !taskBranch.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await createIsolatedAgent({ workspaceId: workspace.id, harnessId: effectiveHarnessId, taskBranch, visibleHarnessIds });
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

  return (
    <Popover open={open && available} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <IconButton
          type="button"
          size="xs"
          variant="ghost"
          className="header-btn header-btn-icon toolbar-btn"
          aria-label="New isolated agent"
          title={title}
          disabled={!available}
        >
          <GitBranch size={14} strokeWidth={2} />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent workspaceId={workspace.id} align="start" className="isolated-agent-popover">
        <form className="isolated-agent-form" onSubmit={(event) => void submit(event)}>
          <Field>
            <FieldLabel htmlFor="isolated-agent-harness">Harness</FieldLabel>
            <Select id="isolated-agent-harness" value={effectiveHarnessId} disabled={busy} onChange={(event) => setChosenHarnessId(event.target.value)}>
              {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="isolated-agent-branch">Task branch</FieldLabel>
            <Input
              id="isolated-agent-branch"
              value={taskBranch}
              disabled={busy}
              placeholder="issue-123-fix-login"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setTaskBranch(event.target.value)}
            />
          </Field>
          {error && <FormMessage variant="error" role="alert">{error}</FormMessage>}
          <Button type="submit" size="sm" variant="primary" disabled={busy || !taskBranch.trim()}>
            {busy ? 'Creating…' : 'Create isolated agent'}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
