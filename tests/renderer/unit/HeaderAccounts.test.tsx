import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UsageWidget from '../../../src/renderer/components/UsageWidget';
import Header from '../../../src/renderer/components/Header';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';
import type { HarnessAccountAuthEvent, HarnessAccountList, SafeHarnessAccount } from '../../../src/shared/types/harnessAccounts';
import type { HarnessUsageEntry } from '../../../src/shared/types/harnessUsage';

vi.mock('../../../src/renderer/components/GitButton', () => ({ default: () => null }));

const SSH_REASON = 'Managed accounts are not available for SSH environments yet.';
const def = (harness = 'codex', selected = true): SafeHarnessAccount => ({ id: 'default', harness, kind: 'default', status: 'unknown', selected });
const work: SafeHarnessAccount = { id: 'acct_1', harness: 'codex', kind: 'managed', label: 'Work', status: 'connected', selected: false };
const localList = (harness = 'codex', accounts: SafeHarnessAccount[] = [def(harness)]): HarnessAccountList =>
  ({ environmentId: 'local', harness, managedSupported: true, accounts });
const sshList = (environmentId = 'ssh-1', harness = 'codex'): HarnessAccountList =>
  ({ environmentId, harness, managedSupported: false, unsupportedReason: SSH_REASON, accounts: [def(harness)] });

let emit: (event: HarnessAccountAuthEvent) => void;
function setWorkspaces(...specs: Array<{ id: string; environmentId?: string }>) {
  useWorkspaceStore.setState({
    activeWorkspaceId: specs[0].id,
    workspaces: specs.map((spec) => createWorkspaceFixture({ id: spec.id, workspacePath: `/${spec.id}`, environmentId: spec.environmentId, terminals: [], panes: [] })),
  });
}
beforeEach(() => {
  installElectronApiMock();
  vi.mocked(window.electronAPI.getHarnessOptions).mockResolvedValue({
    codex: { name: 'Codex', command: 'codex', args: [], icon: 'terminal' },
    claude: { name: 'Claude', command: 'claude', args: [], icon: 'terminal' },
  });
  // Mirrors main: the answer is determined by the environment ID the renderer sends.
  vi.mocked(window.electronAPI.getEnvironmentHarnessOptions).mockResolvedValue({ codex: { name: 'Codex', command: 'codex', args: [], icon: 'terminal' } });
  vi.mocked(window.electronAPI.listHarnessAccounts).mockImplementation(async (environmentId: string, harness: string) =>
    environmentId === 'local' ? localList(harness) : sshList(environmentId, harness));
  vi.mocked(window.electronAPI.onHarnessAccountAuthState).mockImplementation((callback) => { emit = callback; return () => undefined; });
});

async function openCodexSettings(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  const settings = await screen.findByRole('dialog', { name: 'Settings' });
  await user.click(await within(settings).findByRole('button', { name: /^Codex/ }));
}
const listCalls = () => vi.mocked(window.electronAPI.listHarnessAccounts).mock.calls;

describe('Settings account scoping follows the focused workspace environment', () => {
  it('a local workspace manages the local environment', async () => {
    setWorkspaces({ id: 'ws-local', environmentId: 'local' });
    const user = userEvent.setup();
    render(<Header />);
    await openCodexSettings(user);
    expect(await screen.findByRole('button', { name: 'Add account' })).toBeInTheDocument();
    expect(listCalls()).toContainEqual(['local', 'codex']);
  });

  it('a workspace without an explicit environment is local, and no workspace at all defaults to local', async () => {
    setWorkspaces({ id: 'ws-legacy' });
    const user = userEvent.setup();
    render(<Header />);
    await openCodexSettings(user);
    await screen.findByRole('button', { name: 'Add account' });
    expect(listCalls().every(([env]) => env === 'local')).toBe(true);
  });

  it('an SSH workspace manages its own environment ID, shows the unsupported state and offers no add flow', async () => {
    setWorkspaces({ id: 'ws-ssh', environmentId: 'ssh-1' });
    const user = userEvent.setup();
    render(<Header />);
    await openCodexSettings(user);
    expect(await screen.findByText(SSH_REASON)).toBeInTheDocument();
    expect(listCalls()).toContainEqual(['ssh-1', 'codex']);
    expect(listCalls().some(([env]) => env === 'local')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Add account' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove|Reconnect|^Use /})).toBeNull();
    expect(window.electronAPI.startHarnessAccountAdd).not.toHaveBeenCalled();
  });

  it('switching local -> SSH refreshes the account state for the new environment', async () => {
    setWorkspaces({ id: 'ws-local', environmentId: 'local' }, { id: 'ws-ssh', environmentId: 'ssh-1' });
    const user = userEvent.setup();
    render(<Header />);
    await openCodexSettings(user);
    await screen.findByRole('button', { name: 'Add account' });
    act(() => useWorkspaceStore.getState().selectWorkspace('ws-ssh'));
    expect(await screen.findByText(SSH_REASON)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add account' })).toBeNull();
    expect(listCalls()).toContainEqual(['ssh-1', 'codex']);
  });

  it('actions taken from an SSH surface can only ever address the SSH environment, never the local collection', async () => {
    setWorkspaces({ id: 'ws-ssh', environmentId: 'ssh-1' });
    // Even a (hypothetical) managed row in an SSH response routes every mutation to ssh-1.
    vi.mocked(window.electronAPI.listHarnessAccounts).mockResolvedValue({ ...sshList(), accounts: [def(), { ...work, status: 'needs-auth' }] });
    vi.mocked(window.electronAPI.selectHarnessAccount).mockResolvedValue({ ...sshList(), accounts: [def(), { ...work, status: 'needs-auth' }] });
    vi.mocked(window.electronAPI.removeHarnessAccount).mockResolvedValue(sshList());
    vi.mocked(window.electronAPI.reconnectHarnessAccount).mockResolvedValue({ flowId: 'f', state: { status: 'starting' } });
    const user = userEvent.setup();
    render(<Header />);
    await openCodexSettings(user);
    await user.click(await screen.findByRole('button', { name: 'Use Work for Codex' }));
    await user.click(screen.getByRole('button', { name: 'Reconnect' }));
    await waitFor(() => expect(window.electronAPI.reconnectHarnessAccount).toHaveBeenCalled());
    act(() => emit({ flowId: 'f', environmentId: 'ssh-1', harness: 'codex', state: { status: 'cancelled' } }));
    await user.click(await screen.findByRole('button', { name: 'Remove Work' }));
    for (const mock of [window.electronAPI.selectHarnessAccount, window.electronAPI.reconnectHarnessAccount, window.electronAPI.removeHarnessAccount]) {
      const calls = vi.mocked(mock).mock.calls as unknown[][];
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) expect(call[0]).toBe('ssh-1');
    }
  });
});

describe('auth flow scope changes', () => {
  async function startPendingLocalFlow(user: ReturnType<typeof userEvent.setup>) {
    vi.mocked(window.electronAPI.startHarnessAccountAdd).mockResolvedValue({ flowId: 'flow_local', state: { status: 'waiting-for-browser' } });
    await openCodexSettings(user);
    await user.click(await screen.findByRole('button', { name: 'Add account' }));
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('Finish signing in in your browser…');
  }

  it('cancels a pending local Codex login before the SSH scope takes over, and ignores its late events', async () => {
    setWorkspaces({ id: 'ws-local', environmentId: 'local' }, { id: 'ws-ssh', environmentId: 'ssh-1' });
    const user = userEvent.setup();
    render(<Header />);
    await startPendingLocalFlow(user);
    act(() => useWorkspaceStore.getState().selectWorkspace('ws-ssh'));
    await waitFor(() => expect(window.electronAPI.cancelHarnessAccountAuth).toHaveBeenCalledExactlyOnceWith('flow_local'));
    expect(await screen.findByText(SSH_REASON)).toBeInTheDocument();
    expect(screen.queryByText('Finish signing in in your browser…')).toBeNull();
    vi.mocked(window.electronAPI.listHarnessAccounts).mockClear();
    act(() => emit({ flowId: 'flow_local', environmentId: 'local', harness: 'codex', state: { status: 'connected', account: work } }));
    expect(listCalls()).toHaveLength(0); // a late completion neither refreshes nor populates the new scope
    expect(screen.queryByText('Work')).toBeNull();
  });

  it('cancels when the harness scope changes too', async () => {
    const { default: HarnessAccountsRow } = await import('../../../src/renderer/components/settings/HarnessAccountsRow');
    vi.mocked(window.electronAPI.startHarnessAccountAdd).mockResolvedValue({ flowId: 'flow_codex', state: { status: 'waiting-for-browser' } });
    const user = userEvent.setup();
    const view = render(<HarnessAccountsRow harnessId="codex" harnessLabel="Codex" environmentId="local" />);
    await user.click(await screen.findByRole('button', { name: 'Add account' }));
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('Finish signing in in your browser…');
    view.rerender(<HarnessAccountsRow harnessId="claude" harnessLabel="Claude" environmentId="local" />);
    await waitFor(() => expect(window.electronAPI.cancelHarnessAccountAuth).toHaveBeenCalledExactlyOnceWith('flow_codex'));
    await screen.findByRole('button', { name: 'Add account' });
    expect(screen.queryByText('Finish signing in in your browser…')).toBeNull();
  });

  it('still cancels on unmount, and never cancels a flow that already reached a terminal state', async () => {
    const { default: HarnessAccountsRow } = await import('../../../src/renderer/components/settings/HarnessAccountsRow');
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.startHarnessAccountAdd).mockResolvedValueOnce({ flowId: 'flow_done', state: { status: 'waiting-for-browser' } });
    const first = render(<HarnessAccountsRow harnessId="codex" harnessLabel="Codex" environmentId="local" />);
    await user.click(await screen.findByRole('button', { name: 'Add account' }));
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('Finish signing in in your browser…');
    act(() => emit({ flowId: 'flow_done', environmentId: 'local', harness: 'codex', state: { status: 'connected', account: work } }));
    await waitFor(() => expect(screen.queryByText('Finish signing in in your browser…')).toBeNull());
    first.unmount();
    expect(window.electronAPI.cancelHarnessAccountAuth).not.toHaveBeenCalled();

    vi.mocked(window.electronAPI.startHarnessAccountAdd).mockResolvedValueOnce({ flowId: 'flow_open', state: { status: 'waiting-for-browser' } });
    const second = render(<HarnessAccountsRow harnessId="codex" harnessLabel="Codex" environmentId="local" />);
    await user.click(await screen.findByRole('button', { name: 'Add account' }));
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    second.unmount(); // explicit cancel then unmount: idempotent
    expect(window.electronAPI.cancelHarnessAccountAuth).toHaveBeenCalledExactlyOnceWith('flow_open');
  });

  it('cancels a flow whose start request resolves only after the scope already changed', async () => {
    const { default: HarnessAccountsRow } = await import('../../../src/renderer/components/settings/HarnessAccountsRow');
    let finish!: (value: { flowId: string; state: { status: 'starting' } }) => void;
    vi.mocked(window.electronAPI.startHarnessAccountAdd).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const user = userEvent.setup();
    const view = render(<HarnessAccountsRow harnessId="codex" harnessLabel="Codex" environmentId="local" />);
    await user.click(await screen.findByRole('button', { name: 'Add account' }));
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    view.rerender(<HarnessAccountsRow harnessId="codex" harnessLabel="Codex" environmentId="ssh-1" />);
    await act(async () => finish({ flowId: 'flow_late', state: { status: 'starting' } }));
    expect(window.electronAPI.cancelHarnessAccountAuth).toHaveBeenCalledExactlyOnceWith('flow_late');
    expect(await screen.findByText(SSH_REASON)).toBeInTheDocument();
  });
});

describe('Usage → Settings account handoff', () => {
  const usageEntry = (name: string, id: string, selected: boolean): HarnessUsageEntry => ({
    harnessId: 'codex', status: 'ok', measurements: [], checkedAt: 1, account: { id, name, selected },
  });
  beforeEach(() => {
    setWorkspaces({ id: 'ws-local', environmentId: 'local' });
    vi.mocked(window.electronAPI.getHarnessUsage).mockImplementation(async (workspaceId: string | null, request) => ({
      workspaceId: workspaceId ?? undefined, environmentId: 'local', environmentGeneration: 0,
      entries: request?.harnessIds?.[0] === 'codex' ? [usageEntry('Default', 'default', true), usageEntry('Work', 'acct_1', false)] : [],
    }));
    vi.mocked(window.electronAPI.listHarnessAccounts).mockImplementation(async (_environmentId: string, harness: string) =>
      localList(harness, [def(harness), work]));
  });

  it('Manage accounts closes Usage, opens Settings and expands that harness without a second auth UI', async () => {
    const user = userEvent.setup();
    render(<><Header /><UsageWidget /></>);
    await user.click(screen.getByRole('button', { name: 'Usage' }));
    await user.click(await screen.findByRole('button', { name: 'Manage Codex accounts' }));
    expect(screen.queryByRole('dialog', { name: 'Usage' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Codex accounts')).toBeInTheDocument();
    expect(screen.queryByLabelText('Account label')).toBeNull(); // manage does not start adding
    expect(window.electronAPI.startHarnessAccountAdd).not.toHaveBeenCalled();
  });

  it('Add account hands off straight into the existing inline add state (still no auth started until Sign in)', async () => {
    const user = userEvent.setup();
    render(<><Header /><UsageWidget /></>);
    await user.click(screen.getByRole('button', { name: 'Usage' }));
    await user.click(await screen.findByRole('button', { name: 'Add Codex account' }));
    expect(await screen.findByLabelText('Account label')).toBeInTheDocument();
    expect(window.electronAPI.startHarnessAccountAdd).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Account label'), 'Third');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(window.electronAPI.startHarnessAccountAdd).toHaveBeenCalledExactlyOnceWith('local', 'codex', 'Third');
  });

  it('default-only Usage shows no account actions', async () => {
    vi.mocked(window.electronAPI.getHarnessUsage).mockImplementation(async (workspaceId: string | null) => ({
      workspaceId: workspaceId ?? undefined, environmentId: 'local', environmentGeneration: 0, entries: [{ harnessId: 'codex', status: 'ok', measurements: [], checkedAt: 1 }],
    }));
    const user = userEvent.setup();
    render(<><Header /><UsageWidget /></>);
    await user.click(screen.getByRole('button', { name: 'Usage' }));
    await screen.findByRole('region', { name: 'Codex' });
    expect(screen.queryByRole('button', { name: /Manage .* accounts|Add .* account/ })).toBeNull();
  });
});
