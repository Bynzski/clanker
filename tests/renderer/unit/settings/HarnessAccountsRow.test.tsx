import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HarnessAccountsRow from '../../../../src/renderer/components/settings/HarnessAccountsRow';
import UsageDropdown from '../../../../src/renderer/components/UsageDropdown';
import { installElectronApiMock } from '../../../setup/electron';
import type { AccountAuthState, HarnessAccountAuthEvent, HarnessAccountList, SafeHarnessAccount } from '../../../../src/shared/types/harnessAccounts';
import type { HarnessUsageEntry } from '../../../../src/shared/types/harnessUsage';

const def = (selected = true): SafeHarnessAccount => ({ id: 'default', harness: 'codex', kind: 'default', status: 'unknown', selected });
const managed = (over: Partial<SafeHarnessAccount> = {}): SafeHarnessAccount => ({ id: 'acct_1', harness: 'codex', kind: 'managed', label: 'Work', email: 'w@example.test', plan: 'Pro', status: 'connected', selected: false, ...over });
const list = (accounts: SafeHarnessAccount[], over: Partial<HarnessAccountList> = {}): HarnessAccountList =>
  ({ environmentId: 'local', harness: 'codex', managedSupported: true, accounts, ...over });

let emit: (event: HarnessAccountAuthEvent) => void;
beforeEach(() => {
  installElectronApiMock();
  vi.mocked(window.electronAPI.onHarnessAccountAuthState).mockImplementation((callback) => { emit = callback; return () => undefined; });
});

describe('HarnessAccountsRow', () => {
  it('is minimal for a default-only user: just the default account and an unobtrusive Add account', async () => {
    vi.mocked(window.electronAPI.listHarnessAccounts).mockResolvedValue(list([def()]));
    render(<HarnessAccountsRow harnessId="codex" harnessLabel="Codex" />);
    expect(await screen.findByText('Default')).toBeInTheDocument();
    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add account' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Use / })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(window.electronAPI.listHarnessAccounts).toHaveBeenCalledWith('local', 'codex');
  });

  it('shows selection, Use, Reconnect and Remove only for managed accounts and never offers to remove Default', async () => {
    vi.mocked(window.electronAPI.listHarnessAccounts).mockResolvedValue(list([def(), managed({ status: 'needs-auth' })]));
    vi.mocked(window.electronAPI.selectHarnessAccount).mockResolvedValue(list([def(false), managed({ selected: true, status: 'needs-auth' })]));
    render(<HarnessAccountsRow harnessId="codex" harnessLabel="Codex" />);
    expect(await screen.findByText('Work')).toBeInTheDocument();
    expect(screen.getByText('w@example.test · Pro')).toBeInTheDocument();
    expect(screen.getByText('Needs sign-in')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Remove/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use Work for Codex' }));
    expect(window.electronAPI.selectHarnessAccount).toHaveBeenCalledWith('local', 'codex', 'acct_1');
    expect(await screen.findByText('In use')).toBeInTheDocument();
  });

  it('runs the add flow from main-owned events: waiting, then connected, then refreshes the list', async () => {
    vi.mocked(window.electronAPI.listHarnessAccounts).mockResolvedValueOnce(list([def()])).mockResolvedValue(list([def(), managed()]));
    vi.mocked(window.electronAPI.startHarnessAccountAdd).mockResolvedValue({ flowId: 'flow_1', state: { status: 'starting' } });
    render(<HarnessAccountsRow harnessId="codex" harnessLabel="Codex" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add account' }));
    await userEvent.type(screen.getByLabelText('Account label'), 'Work');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(window.electronAPI.startHarnessAccountAdd).toHaveBeenCalledWith('local', 'codex', 'Work');
    expect(await screen.findByText('Starting sign-in…')).toBeInTheDocument();

    const waiting: AccountAuthState = { status: 'waiting-for-browser' };
    act(() => emit({ flowId: 'flow_1', environmentId: 'local', harness: 'codex', state: waiting }));
    expect(await screen.findByText('Finish signing in in your browser…')).toBeInTheDocument();
    act(() => emit({ flowId: 'flow_1', environmentId: 'local', harness: 'codex', state: { status: 'connected', account: managed() } }));
    expect(await screen.findByText('Work')).toBeInTheDocument();
    expect(window.electronAPI.listHarnessAccounts).toHaveBeenCalledTimes(2);
  });

  it('keeps an event that arrives before the start request resolves', async () => {
    vi.mocked(window.electronAPI.listHarnessAccounts).mockResolvedValue(list([def()]));
    vi.mocked(window.electronAPI.startHarnessAccountAdd).mockImplementation(async () => {
      emit({ flowId: 'flow_early', environmentId: 'local', harness: 'codex', state: { status: 'failed', message: 'Sign-in failed. Try again.' } });
      return { flowId: 'flow_early', state: { status: 'starting' } };
    });
    render(<HarnessAccountsRow harnessId="codex" harnessLabel="Codex" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add account' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in failed. Try again.');
  });

  it('cancels a pending sign-in once on request (unmount does not repeat it)', async () => {
    vi.mocked(window.electronAPI.listHarnessAccounts).mockResolvedValue(list([def()]));
    vi.mocked(window.electronAPI.startHarnessAccountAdd).mockResolvedValue({ flowId: 'flow_9', state: { status: 'waiting-for-browser' } });
    const view = render(<HarnessAccountsRow harnessId="codex" harnessLabel="Codex" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add account' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(window.electronAPI.cancelHarnessAccountAuth).toHaveBeenCalledWith('flow_9');
    view.unmount(); // already cancelled: unmount must not cancel it a second time
    expect(window.electronAPI.cancelHarnessAccountAuth).toHaveBeenCalledExactlyOnceWith('flow_9');
  });

  it('shows the explicit SSH limitation instead of an Add account button', async () => {
    vi.mocked(window.electronAPI.listHarnessAccounts).mockResolvedValue(list([def()], { environmentId: 'ssh-1', managedSupported: false, unsupportedReason: 'Managed accounts are not available for SSH environments yet.' }));
    render(<HarnessAccountsRow harnessId="codex" harnessLabel="Codex" environmentId="ssh-1" />);
    expect(await screen.findByText('Managed accounts are not available for SSH environments yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add account' })).toBeNull();
    expect(window.electronAPI.listHarnessAccounts).toHaveBeenCalledWith('ssh-1', 'codex');
  });

  it('surfaces only the safe message from a rejected operation', async () => {
    vi.mocked(window.electronAPI.listHarnessAccounts).mockResolvedValue(list([def(), managed()]));
    vi.mocked(window.electronAPI.removeHarnessAccount).mockRejectedValue(new Error("Error invoking remote method 'harness-accounts:remove': Error: Work could not be signed out. Try again."));
    render(<HarnessAccountsRow harnessId="codex" harnessLabel="Codex" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Work' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/^Work could not be signed out\. Try again\.$/));
  });
});

describe('UsageDropdown accounts', () => {
  const entry = (name: string, selected: boolean, id: string): HarnessUsageEntry => ({
    harnessId: 'codex', status: 'ok', measurements: [{ kind: 'rate-limit', unit: 'percent', used: 5, limit: 100, label: '5 hour' }],
    checkedAt: 1, account: { id, name, selected },
  });
  const base = { harnessIds: ['codex'], pending: {}, refreshing: false, now: 2, canRefresh: true, onRefresh: vi.fn() };

  it('offers Use for other accounts through the account service, not the usage service', async () => {
    const onSelectAccount = vi.fn();
    render(<UsageDropdown {...base} entries={{ codex: entry('Default', true, 'default') }} otherAccounts={{ codex: [entry('Work', false, 'acct_1')] }} onSelectAccount={onSelectAccount} />);
    expect(screen.getByText('Codex · Default')).toBeInTheDocument();
    expect(screen.getByText('Codex · Work')).toBeInTheDocument();
    expect(screen.getByText('In use')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use Work for Codex' }));
    expect(onSelectAccount).toHaveBeenCalledWith('codex', 'acct_1');
  });

  it('looks exactly as before for a default-only user', () => {
    const plain: HarnessUsageEntry = { harnessId: 'codex', status: 'ok', measurements: [], checkedAt: 1 };
    render(<UsageDropdown {...base} entries={{ codex: plain }} />);
    expect(screen.getByText('Codex')).toBeInTheDocument();
    expect(screen.queryByText('In use')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Use / })).toBeNull();
  });
});

describe('useHarnessUsage accounts', () => {
  it('splits the selected account from the others and selects through the account service', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { useHarnessUsage } = await import('../../../../src/renderer/components/useHarnessUsage');
    const entry = (id: string, selected: boolean): HarnessUsageEntry => ({ harnessId: 'codex', status: 'ok', measurements: [], account: { id, name: id, selected } });
    vi.mocked(window.electronAPI.getHarnessUsage).mockResolvedValue({ environmentId: 'local', environmentGeneration: 0, entries: [entry('acct_1', true), entry('default', false)] });
    vi.mocked(window.electronAPI.selectHarnessAccount).mockResolvedValue(list([def()]));
    const { result } = renderHook(() => useHarnessUsage({ workspaceId: 'w', open: true, harnessIds: ['codex'], environmentId: 'local' }));
    await waitFor(() => expect(result.current.entries.codex?.account?.id).toBe('acct_1'));
    expect(result.current.otherAccounts.codex?.map((other) => other.account?.id)).toEqual(['default']);
    act(() => result.current.selectAccount('codex', 'default'));
    expect(window.electronAPI.selectHarnessAccount).toHaveBeenCalledWith('local', 'codex', 'default');
  });
});
