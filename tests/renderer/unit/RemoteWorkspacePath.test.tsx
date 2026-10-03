// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import RemoteWorkspacePath from '../../../src/renderer/components/RemoteWorkspacePath';
import { installElectronApiMock } from '../../setup/electron';

type Home = { homePath: string; initialPath: string };
const home = (id: string): Home => ({ homePath: `/home/${id}`, initialPath: `/home/${id}/workspaces` });

function Harness({ environmentId }: { environmentId: string }) {
  const [path, setPath] = useState('');
  return <RemoteWorkspacePath environmentId={environmentId} path={path} onPathChange={setPath} onSubmit={() => undefined} />;
}

describe('RemoteWorkspacePath home lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installElectronApiMock();
  });
  afterEach(() => cleanup());

  const input = () => screen.getByRole('textbox', { name: 'Remote Directory Path' }) as HTMLInputElement;

  it('retries the same environment after a failure and fills the initial path', async () => {
    vi.mocked(window.electronAPI.sshGetHomeDirectory)
      .mockRejectedValueOnce(new Error('SSH connection was refused. Check that sshd is running and the port is correct.'))
      .mockResolvedValueOnce(home('alpha'));
    render(<Harness environmentId="alpha" />);
    expect((await screen.findByRole('alert')).textContent).toContain('SSH connection was refused');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(input().value).toBe('/home/alpha/workspaces'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(window.electronAPI.sshGetHomeDirectory).toHaveBeenCalledTimes(2);
    expect(window.electronAPI.sshGetHomeDirectory).toHaveBeenLastCalledWith('alpha');
  });

  it('keeps a manually typed path through a failed lookup and a successful retry', async () => {
    vi.mocked(window.electronAPI.sshGetHomeDirectory)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(home('alpha'));
    render(<Harness environmentId="alpha" />);
    await screen.findByRole('alert');
    fireEvent.change(input(), { target: { value: '/opt/custom' } });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(window.electronAPI.sshGetHomeDirectory).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(input().value).toBe('/opt/custom');
  });

  it('shows the error again when the retry fails, and clears it while loading', async () => {
    let rejectSecond!: (error: Error) => void;
    vi.mocked(window.electronAPI.sshGetHomeDirectory)
      .mockRejectedValueOnce(new Error('first'))
      .mockImplementationOnce(() => new Promise<Home>((_resolve, reject) => { rejectSecond = reject; }));
    render(<Harness environmentId="alpha" />);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => rejectSecond(new Error('second')));
    expect((await screen.findByRole('alert')).textContent).toContain('second');
  });

  it('ignores a late result from a previous environment after switching', async () => {
    let resolveAlpha!: (value: Home) => void;
    vi.mocked(window.electronAPI.sshGetHomeDirectory).mockImplementation((id: string) => id === 'alpha'
      ? new Promise<Home>((resolve) => { resolveAlpha = resolve; })
      : Promise.resolve(home('beta')));
    const { rerender } = render(<Harness environmentId="alpha" />);
    rerender(<Harness environmentId="beta" />);
    await waitFor(() => expect(input().value).toBe('/home/beta/workspaces'));
    await act(async () => resolveAlpha(home('alpha')));
    expect(input().value).toBe('/home/beta/workspaces');
  });

  it('ignores a superseded failed lookup after Retry succeeds', async () => {
    let rejectFirst!: (error: Error) => void;
    vi.mocked(window.electronAPI.sshGetHomeDirectory)
      .mockImplementationOnce(() => new Promise<Home>((_resolve, reject) => { rejectFirst = reject; }))
      .mockResolvedValueOnce(home('alpha'));
    render(<Harness environmentId="alpha" />);
    // The first lookup is still pending, so no Retry exists yet; a late failure must not outlive a newer run.
    await waitFor(() => expect(window.electronAPI.sshGetHomeDirectory).toHaveBeenCalledTimes(1));
    await act(async () => rejectFirst(new Error('late failure')));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(input().value).toBe('/home/alpha/workspaces'));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
