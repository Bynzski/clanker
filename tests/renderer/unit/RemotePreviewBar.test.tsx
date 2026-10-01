import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installElectronApiMock } from '../../setup/electron';
import RemotePreviewBar from '../../../src/renderer/components/RemotePreviewBar';
import type { RemotePreviewUpdate, RemotePreviewResult } from '../../../src/shared/types/remotePreview';

const active = { workspaceId: 'ssh-a', remotePort: 3000, localPort: 4000, status: 'active' as const, url: 'http://127.0.0.1:4000/' };
beforeEach(() => { installElectronApiMock(); });
function fixture() {
  const onOpen = vi.fn().mockResolvedValue(undefined);
  const onLayoutChange = vi.fn();
  let notify!: (update: RemotePreviewUpdate) => void;
  vi.mocked(window.electronAPI.onRemotePreviewChanged).mockImplementation((callback) => { notify = callback; return vi.fn(); });
  const view = render(<RemotePreviewBar workspaceId="ssh-a" onOpen={onOpen} onLayoutChange={onLayoutChange} />);
  return { ...view, onOpen, notify: (update: RemotePreviewUpdate) => notify(update) };
}
describe('RemotePreviewBar', () => {
  it('starts explicit ports, opens the confirmed URL, and stops the workspace preview', async () => {
    vi.mocked(window.electronAPI.remotePreviewStart).mockResolvedValue({ success: true, forward: active });
    const { onOpen } = fixture();
    fireEvent.change(screen.getByLabelText('Local preview port'), { target: { value: '4000' } });
    fireEvent.click(screen.getByText('Start preview'));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(active.url));
    expect(window.electronAPI.remotePreviewStart).toHaveBeenCalledWith({ workspaceId: 'ssh-a', localPort: 4000, remotePort: 3000 });
    fireEvent.click(screen.getByText('Stop preview'));
    await waitFor(() => expect(window.electronAPI.remotePreviewStop).toHaveBeenCalledWith({ workspaceId: 'ssh-a' }));
    await waitFor(() => expect(screen.queryByText('Stop preview')).toBeNull());
  });
  it('uses shared port fields and locks controls during start/stop, then opens the active preview', async () => {
    let finishStart!: (result: RemotePreviewResult) => void;
    let finishStop!: (result: boolean) => void;
    vi.mocked(window.electronAPI.remotePreviewStart).mockReturnValue(new Promise((resolve) => { finishStart = resolve; }));
    vi.mocked(window.electronAPI.remotePreviewStop).mockReturnValue(new Promise((resolve) => { finishStop = resolve; }));
    const { onOpen } = fixture();
    for (const label of ['Remote preview port', 'Local preview port']) {
      const input = screen.getByLabelText(label);
      expect(input).toHaveClass('clanker-input');
      expect(input).toHaveAttribute('min', '1024');
      expect(input).toHaveAttribute('max', '65535');
    }
    fireEvent.change(screen.getByLabelText('Remote preview port'), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText('Local preview port'), { target: { value: '4000' } });
    const start = screen.getByRole('button', { name: 'Start preview' });
    expect(start).toHaveClass('clanker-button');
    fireEvent.click(start);
    expect(start).toBeDisabled();
    expect(screen.getByLabelText('Remote preview port')).toBeDisabled();
    expect(screen.getByLabelText('Local preview port')).toBeDisabled();
    expect(window.electronAPI.remotePreviewStart).toHaveBeenCalledWith({ workspaceId: 'ssh-a', remotePort: 5000, localPort: 4000 });
    await act(async () => finishStart({ success: true, forward: { ...active, remotePort: 5000 } }));
    onOpen.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Open preview' }));
    expect(onOpen).toHaveBeenCalledWith(active.url);
    fireEvent.click(screen.getByRole('button', { name: 'Stop preview' }));
    expect(screen.getByRole('button', { name: 'Stop preview' })).toBeDisabled();
    await act(async () => finishStop(true));
    expect(screen.getByLabelText('Remote preview port')).toBeEnabled();
  });
  it('shows conflicts without navigation and permits retry with another local port', async () => {
    vi.mocked(window.electronAPI.remotePreviewStart).mockResolvedValue({ success: false, forward: { ...active, status: 'error', error: 'Address already in use' }, error: 'Address already in use' });
    const { onOpen } = fixture();
    fireEvent.click(screen.getByText('Start preview'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Address already in use'));
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Local preview port')).toBeEnabled();
    expect(screen.getByText('Retry preview')).toBeEnabled();
    vi.mocked(window.electronAPI.remotePreviewStart).mockResolvedValue({ success: true, forward: { ...active, localPort: 4001, url: 'http://127.0.0.1:4001/' } });
    fireEvent.change(screen.getByLabelText('Local preview port'), { target: { value: '4001' } });
    fireEvent.click(screen.getByText('Retry preview'));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('http://127.0.0.1:4001/'));
  });
  it('validates ports and ignores events belonging to other workspaces', async () => {
    const { notify } = fixture();
    fireEvent.change(screen.getByLabelText('Remote preview port'), { target: { value: '80' } });
    fireEvent.click(screen.getByText('Start preview'));
    expect(screen.getByRole('alert').textContent).toContain('1024');
    expect(window.electronAPI.remotePreviewStart).not.toHaveBeenCalled();
    act(() => notify({ workspaceId: 'ssh-b', forward: { ...active, workspaceId: 'ssh-b' } }));
    expect(screen.queryByText('Stop preview')).toBeNull();
  });
  it('ignores a late successful start after unmount or a newer connection failure', async () => {
    let resolve!: (value: RemotePreviewResult) => void;
    vi.mocked(window.electronAPI.remotePreviewStart).mockReturnValue(new Promise((res) => { resolve = res; }));
    const { onOpen, notify, unmount } = fixture();
    fireEvent.click(screen.getByText('Start preview'));
    act(() => notify({ workspaceId: 'ssh-a', forward: { ...active, status: 'error', error: 'SSH disconnected' } }));
    await act(async () => resolve({ success: true, forward: active }));
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('SSH disconnected');
    vi.mocked(window.electronAPI.remotePreviewStart).mockReturnValue(new Promise((res) => { resolve = res; }));
    fireEvent.click(screen.getByText('Retry preview'));
    unmount();
    await act(async () => resolve({ success: true, forward: active }));
    expect(onOpen).not.toHaveBeenCalled();
  });
});
