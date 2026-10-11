import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CommitComposer } from '../../../../src/renderer/components/git/CommitComposer';
import { useCommitComposer } from '../../../../src/renderer/components/git/useCommitComposer';
import { installElectronApiMock } from '../../../setup/electron';

let api: ReturnType<typeof installElectronApiMock>;
const isCurrent = () => true;
const defaults = () => ({ enabled: true, workspacePath: '/repo', workspaceId: 'ws', environmentId: 'local', revision: 'one',
  hasStaged: true, hasWorking: true, disabled: false, isCurrent, onCommit: vi.fn().mockResolvedValue({ success: true }) });
beforeEach(() => {
  api = installElectronApiMock({ getAiCommitSettings: vi.fn().mockResolvedValue({ enabled: true, provider: 'codex', model: 'configured' }),
    generateCommitMessage: vi.fn().mockResolvedValue({ success: true, message: 'feat: generated' }) });
});
function Surface({ options = defaults() }) {
  const composer = useCommitComposer(options);
  return <CommitComposer composer={composer} stagedCount={options.hasStaged ? 1 : 0} workingCount={options.hasWorking ? 1 : 0}
    disabled={options.disabled} progress={null} />;
}

it('provides a permanent multiline composer without a modal or duplicated staging/file controls', async () => {
  render(<Surface />);
  expect(screen.getByRole('textbox', { name: 'Commit Message' }).tagName).toBe('TEXTAREA');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Stage All' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Unstage All' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Commit Staged' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Stage All & Commit' })).toBeDisabled();
  await screen.findByRole('button', { name: 'Generate' });
  expect(api.generateCommitMessage).not.toHaveBeenCalled();
});

it.each([
  { hasStaged: false, hasWorking: false, disabled: false, staged: false, all: false },
  { hasStaged: false, hasWorking: true, disabled: false, staged: false, all: true },
  { hasStaged: true, hasWorking: false, disabled: false, staged: true, all: false },
  { hasStaged: true, hasWorking: true, disabled: false, staged: true, all: true },
  { hasStaged: true, hasWorking: true, disabled: true, staged: false, all: false },
])('respects availability and primary action: %j', async (state) => {
  const options = { ...defaults(), ...state };
  const { rerender } = render(<Surface options={{ ...options, disabled: false }} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'message' } });
  rerender(<Surface options={options} />);
  expect(screen.getByRole('button', { name: 'Commit Staged' }).hasAttribute('disabled')).toBe(!state.staged);
  expect(screen.getByRole('button', { name: 'Stage All & Commit' }).hasAttribute('disabled')).toBe(!state.all);
  expect(screen.getByRole('button', { name: state.hasStaged ? 'Commit Staged' : 'Stage All & Commit' })).toHaveAttribute('data-variant', 'primary');
});

it('preserves message validation, staged-only submission and explicit all-mode routing', async () => {
  const options = defaults();
  render(<Surface options={options} />);
  fireEvent.submit(screen.getByRole('form'));
  expect(await screen.findByText('Please enter a commit message')).toBeVisible();
  expect(options.onCommit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'feat: selected' } });
  fireEvent.submit(screen.getByRole('form'));
  await waitFor(() => expect(options.onCommit).toHaveBeenCalledWith('feat: selected', false));
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'feat: all' } });
  fireEvent.click(screen.getByRole('button', { name: 'Stage All & Commit' }));
  await waitFor(() => expect(options.onCommit).toHaveBeenLastCalledWith('feat: all', true));
});

it('does not submit a clean tree or silently stage on ordinary submission with only working files', async () => {
  const options = { ...defaults(), hasStaged: false };
  const { rerender } = render(<Surface options={options} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'message' } });
  fireEvent.submit(screen.getByRole('form'));
  expect(options.onCommit).not.toHaveBeenCalled();
  expect(screen.getByText('Stage changes before committing.')).toBeVisible();
  rerender(<Surface options={{ ...options, hasWorking: false }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Stage All & Commit' }));
  expect(options.onCommit).not.toHaveBeenCalled();
});

it('guards duplicate submissions and preserves drafts on rejection, failure and recovery', async () => {
  const options = defaults(); let finish!: (value: unknown) => void;
  options.onCommit.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  render(<Surface options={options} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'my message' } });
  fireEvent.submit(screen.getByRole('form')); fireEvent.submit(screen.getByRole('form'));
  expect(options.onCommit).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('textbox')).toBeDisabled();
  await act(async () => finish({ success: false, error: 'Hook denied' }));
  expect(screen.getByText('Hook denied')).toBeVisible(); expect(screen.getByRole('textbox')).toHaveValue('my message');
  options.onCommit.mockRejectedValueOnce(new Error('Transport failed'));
  fireEvent.submit(screen.getByRole('form'));
  expect(await screen.findByText('Transport failed')).toBeVisible();
  expect(screen.getByRole('textbox')).toHaveValue('my message');
  fireEvent.submit(screen.getByRole('form'));
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
});

it.each(['disabled', 'SSH', 'settings failure'])('hides unsupported AI generation: %s', async (kind) => {
  if (kind === 'disabled') api.getAiCommitSettings.mockResolvedValue({ enabled: false, provider: 'codex', model: '' });
  if (kind === 'settings failure') api.getAiCommitSettings.mockRejectedValue(new Error('Unavailable'));
  const options = { ...defaults(), environmentId: kind === 'SSH' ? 'ssh-host' : 'local' };
  render(<Surface options={options} />);
  await waitFor(() => expect(api.getAiCommitSettings).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: 'Generate' })).toBeNull();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'manual commit' } });
  fireEvent.submit(screen.getByRole('form'));
  await waitFor(() => expect(options.onCommit).toHaveBeenCalledWith('manual commit', false));
  expect(api.generateCommitMessage).not.toHaveBeenCalled();
});

it('uses existing configured inference IPC, restores editor focus and preserves generation errors/drafts', async () => {
  render(<Surface />);
  fireEvent.click(await screen.findByRole('button', { name: 'Generate' }));
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('feat: generated'));
  expect(screen.getByRole('textbox')).toHaveFocus();
  expect(api.generateCommitMessage).toHaveBeenCalledWith('/repo', 'ws');
  api.generateCommitMessage.mockResolvedValueOnce({ success: false, error: 'Provider unavailable' });
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  expect(await screen.findByText('Provider unavailable')).toBeVisible();
  expect(screen.getByRole('textbox')).toHaveValue('feat: generated');
  api.generateCommitMessage.mockRejectedValueOnce(new Error('CLI failed'));
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  expect(await screen.findByText('CLI failed')).toBeVisible();
});

it.each(['edit', 'close', 'root', 'workspace', 'environment', 'changes'])('rejects obsolete inference after %s without erasing the correct draft', async (transition) => {
  let finish!: (value: unknown) => void;
  api.generateCommitMessage.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const options = defaults();
  const { result, rerender } = renderHook((props) => useCommitComposer(props), { initialProps: options });
  await waitFor(() => expect(result.current.aiEnabled).toBe(true));
  act(() => result.current.editMessage('draft'));
  act(() => { void result.current.generate(); });
  if (transition === 'edit') act(() => result.current.editMessage('user edit'));
  else rerender({ ...options, enabled: transition !== 'close', workspacePath: transition === 'root' ? '/other' : '/repo',
    workspaceId: transition === 'workspace' ? 'other' : 'ws', environmentId: transition === 'environment' ? 'ssh-host' : 'local', revision: transition === 'changes' ? 'two' : 'one' });
  await act(async () => finish({ success: true, message: 'obsolete generation' }));
  expect(result.current.message).toBe(transition === 'edit' ? 'user edit' : ['root', 'workspace', 'environment'].includes(transition) ? '' : 'draft');
  if (transition === 'changes') expect(result.current.error).toContain('Changes updated');
});

it('does not clear a newer draft after an A → B → A submission scope cycle', async () => {
  const options = defaults(); let finish!: (value: unknown) => void;
  options.onCommit.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const { result, rerender } = renderHook((props) => useCommitComposer(props), { initialProps: options });
  act(() => result.current.editMessage('old A draft'));
  act(() => { void result.current.submit(); });
  rerender({ ...options, workspacePath: '/other' }); rerender(options);
  act(() => result.current.editMessage('new A draft'));
  await act(async () => finish({ success: true }));
  expect(result.current.message).toBe('new A draft');
});

it('keeps generation failures visible even when the user edits the pending draft', async () => {
  let finish!: (value: unknown) => void;
  api.generateCommitMessage.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  render(<Surface />);
  fireEvent.click(await screen.findByRole('button', { name: 'Generate' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'my edited draft' } });
  await act(async () => finish({ success: false, error: 'Harness unavailable' }));
  expect(screen.getByText('Harness unavailable')).toBeVisible();
  expect(screen.getByRole('textbox')).toHaveValue('my edited draft');
});

it('lets a newer request supersede an older generation and rejects results after unmount', async () => {
  let first!: (value: unknown) => void; let second!: (value: unknown) => void;
  api.generateCommitMessage.mockImplementationOnce(() => new Promise((resolve) => { first = resolve; }))
    .mockImplementationOnce(() => new Promise((resolve) => { second = resolve; }));
  const { result, unmount } = renderHook(() => useCommitComposer(defaults()));
  await waitFor(() => expect(result.current.aiEnabled).toBe(true));
  act(() => { void result.current.generate(); void result.current.generate(); });
  await act(async () => second({ success: true, message: 'latest' }));
  await act(async () => first({ success: true, message: 'old' }));
  expect(result.current.message).toBe('latest');
  api.generateCommitMessage.mockImplementationOnce(() => new Promise((resolve) => { first = resolve; }));
  act(() => { void result.current.generate(); }); unmount();
  await act(async () => first({ success: true, message: 'late' }));
});
