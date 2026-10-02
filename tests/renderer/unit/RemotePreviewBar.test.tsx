import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installElectronApiMock } from '../../setup/electron';
import RemotePreviewBar from '../../../src/renderer/components/RemotePreviewBar';
import type { RemotePreviewUpdate, RemotePreviewResult, RemoteWebService } from '../../../src/shared/types/remotePreview';
const active = { workspaceId: 'ssh-a', remotePort: 5173, remoteHost: '127.0.0.1' as const, protocol: 'http' as const, localPort: 4000, serviceId: 'vite', status: 'active' as const, url: 'http://127.0.0.1:4000/' };
const service: RemoteWebService = { remoteHost: '127.0.0.1', remotePort: 5173, protocol: 'http', source: 'listener', processName: 'node', confidence: 'workspace' };
beforeEach(() => installElectronApiMock());
function fixture() {
  const onOpen = vi.fn().mockResolvedValue(undefined), onLayoutChange = vi.fn(); let notify!: (update: RemotePreviewUpdate) => void;
  vi.mocked(window.electronAPI.onRemotePreviewChanged).mockImplementation((callback) => { notify = callback; return vi.fn(); });
  const view = render(<RemotePreviewBar workspaceId="ssh-a" onOpen={onOpen} onLayoutChange={onLayoutChange} />);
  return { ...view, onOpen, onLayoutChange, notify: (update: Partial<RemotePreviewUpdate>) => act(() => notify({ workspaceId: 'ssh-a', forward: null, forwards: [], services: [], ...update })) };
}
describe('detected SSH previews', () => {
  it('retains discovery, shows a friendly empty state and releases the consumer on unmount', async () => {
    const f = fixture(); expect(screen.getByText('No web server detected yet')).toBeInTheDocument();
    expect(screen.queryByLabelText('Local preview port')).toBeNull(); expect(screen.queryByLabelText('Remote preview port')).toBeNull();
    await waitFor(() => expect(window.electronAPI.remotePreviewWatch).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ssh-a', enabled: true })));
    f.unmount(); expect(window.electronAPI.remotePreviewWatch).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
  });
  it('automatically forwards and opens one high-confidence service starting after Browser opens', async () => {
    vi.mocked(window.electronAPI.remotePreviewStart).mockResolvedValue({ success: true, forward: active });
    const f = fixture(); f.notify({ services: [service] });
    await waitFor(() => expect(f.onOpen).toHaveBeenCalledWith(active.url));
    expect(window.electronAPI.remotePreviewStart).toHaveBeenCalledWith({ workspaceId: 'ssh-a', remotePort: 5173, remoteHost: '127.0.0.1', protocol: 'http' });
    expect(screen.getByText('Ready on port 5173')).toBeInTheDocument();
  });
  it('shows multiple services without silently choosing, and opens an explicit selection', async () => {
    vi.mocked(window.electronAPI.remotePreviewStart).mockResolvedValue({ success: true, forward: active });
    const f = fixture(); f.notify({ services: [service, { ...service, remotePort: 6006, processName: 'storybook' }] });
    expect(window.electronAPI.remotePreviewStart).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Detected web services'), { target: { value: 'http:127.0.0.1:5173' } });
    fireEvent.click(screen.getByRole('button', { name: /^Open$/ }));
    await waitFor(() => expect(f.onOpen).toHaveBeenCalledWith(active.url));
  });
  it('does not auto-open an unscoped server and explains missing ownership', () => {
    const f = fixture(); f.notify({ services: [{ ...service, confidence: 'unscoped' }] });
    fireEvent.change(screen.getByLabelText('Detected web services'), { target: { value: 'http:127.0.0.1:5173' } });
    expect(screen.getByText(/Could not determine whether/)).toBeInTheDocument(); expect(window.electronAPI.remotePreviewStart).not.toHaveBeenCalled();
  });
  it('waits through a service stop and automatically reopens it when it returns', async () => {
    vi.mocked(window.electronAPI.remotePreviewStart).mockResolvedValue({ success: true, forward: { ...active, status: 'waiting' } });
    const f = fixture(); f.notify({ services: [service] }); await waitFor(() => expect(window.electronAPI.remotePreviewStart).toHaveBeenCalled());
    f.notify({ services: [service], forwards: [{ ...active, status: 'waiting' }] });
    expect(screen.getByText('Waiting for remote service on port 5173…')).toBeInTheDocument(); expect(f.onOpen).not.toHaveBeenCalled();
    f.notify({ services: [service], forwards: [active] }); await waitFor(() => expect(f.onOpen).toHaveBeenCalledTimes(1));
    f.notify({ forwards: [{ ...active, status: 'waiting' }] }); f.notify({ services: [service], forwards: [active] });
    await waitFor(() => expect(f.onOpen).toHaveBeenCalledTimes(2)); expect(window.electronAPI.remotePreviewStart).toHaveBeenCalledTimes(1);
  });
  it('changes automatic selection when a server moves ports and releases the old forward', async () => {
    vi.mocked(window.electronAPI.remotePreviewStart).mockResolvedValue({ success: true, forward: active });
    const f = fixture(); f.notify({ services: [service] }); await waitFor(() => expect(f.onOpen).toHaveBeenCalled());
    f.notify({ services: [{ ...service, remotePort: 5174 }], forwards: [active] });
    await waitFor(() => expect(window.electronAPI.remotePreviewStart).toHaveBeenLastCalledWith(expect.objectContaining({ remotePort: 5174 })));
    expect(window.electronAPI.remotePreviewStop).toHaveBeenCalledWith({ workspaceId: 'ssh-a', serviceId: 'vite' });
  });
  it('manual fallback requests only a remote port/protocol and validates input', async () => {
    vi.mocked(window.electronAPI.remotePreviewStart).mockResolvedValue({ success: false, forward: null, error: 'SSH server rejected TCP forwarding' });
    const f = fixture(); fireEvent.click(screen.getByText('Forward port manually…'));
    fireEvent.change(screen.getByLabelText('Remote preview port'), { target: { value: '80' } }); fireEvent.click(screen.getByText('Forward and open'));
    expect(window.electronAPI.remotePreviewStart).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Remote preview port'), { target: { value: '8080' } }); fireEvent.change(screen.getByLabelText('Preview protocol'), { target: { value: 'https' } });
    fireEvent.click(screen.getByText('Forward and open'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('SSH server rejected TCP forwarding'));
    expect(window.electronAPI.remotePreviewStart).toHaveBeenCalledWith({ workspaceId: 'ssh-a', remotePort: 8080, remoteHost: '127.0.0.1', protocol: 'https' }); expect(f.onOpen).not.toHaveBeenCalled();
  });
  it('ignores another workspace and delayed success after unmount', async () => {
    let resolve!: (result: RemotePreviewResult) => void; vi.mocked(window.electronAPI.remotePreviewStart).mockReturnValue(new Promise((res) => { resolve = res; }));
    const f = fixture(); f.notify({ workspaceId: 'other', services: [service] }); expect(window.electronAPI.remotePreviewStart).not.toHaveBeenCalled();
    f.notify({ services: [service] }); await waitFor(() => expect(window.electronAPI.remotePreviewStart).toHaveBeenCalled());
    f.unmount(); await act(async () => resolve({ success: true, forward: active })); expect(f.onOpen).not.toHaveBeenCalled();
  });
  it('suspends discovery when Browser becomes irrelevant and does not reopen hidden tabs', async () => {
    const f = fixture(); f.rerender(<RemotePreviewBar workspaceId="ssh-a" enabled={false} onOpen={f.onOpen} onLayoutChange={f.onLayoutChange} />);
    f.notify({ services: [service], forwards: [active] }); expect(f.onOpen).not.toHaveBeenCalled();
    expect(window.electronAPI.remotePreviewWatch).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
  });
});
it('opens a selected service that became ready while Browser was hidden on return', async () => {
  vi.mocked(window.electronAPI.remotePreviewStart).mockResolvedValue({ success: true, forward: { ...active, status: 'waiting' } });
  const f = fixture(); f.notify({ services: [service] }); await waitFor(() => expect(window.electronAPI.remotePreviewStart).toHaveBeenCalled());
  f.rerender(<RemotePreviewBar workspaceId="ssh-a" enabled={false} onOpen={f.onOpen} onLayoutChange={f.onLayoutChange} />);
  f.notify({ services: [service], forwards: [active] }); expect(f.onOpen).not.toHaveBeenCalled();
  vi.mocked(window.electronAPI.remotePreviewWatch).mockResolvedValue({ workspaceId: 'ssh-a', forward: active, forwards: [active], services: [service] });
  f.rerender(<RemotePreviewBar workspaceId="ssh-a" enabled onOpen={f.onOpen} onLayoutChange={f.onLayoutChange} />);
  await waitFor(() => expect(f.onOpen).toHaveBeenCalledExactlyOnceWith(active.url));
  expect(window.electronAPI.remotePreviewStart).toHaveBeenCalledTimes(1);
});
it('never bootstraps automatic forwarding from GET and discards a late disabled lease snapshot', async () => {
  vi.mocked(window.electronAPI.remotePreviewGet).mockResolvedValue({ workspaceId: 'ssh-a', forward: null, services: [service] });
  let finish!: (snapshot: RemotePreviewUpdate) => void;
  vi.mocked(window.electronAPI.remotePreviewWatch).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const f = fixture();
  f.rerender(<RemotePreviewBar workspaceId="ssh-a" enabled={false} onOpen={f.onOpen} onLayoutChange={f.onLayoutChange} />);
  await act(async () => finish({ workspaceId: 'ssh-a', forward: null, services: [service] }));
  f.rerender(<RemotePreviewBar workspaceId="ssh-a" enabled onOpen={f.onOpen} onLayoutChange={f.onLayoutChange} />);
  await act(async () => {});
  expect(window.electronAPI.remotePreviewGet).not.toHaveBeenCalled();
  expect(window.electronAPI.remotePreviewStart).not.toHaveBeenCalled(); expect(f.onOpen).not.toHaveBeenCalled();
});
