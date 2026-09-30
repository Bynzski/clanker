// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SshEnvironmentManager from '../../../src/renderer/components/SshEnvironmentManager';
import { installElectronApiMock } from '../../setup/electron';

describe('SSH target manager', () => {
  const config = { id: 'saved-host', kind: 'ssh' as const, label: 'Host', target: 'user@host', defaultWorkspaceRoot: '/srv/repos' };
  let api: ReturnType<typeof installElectronApiMock>;
  const onSaved = vi.fn();
  const onDeleted = vi.fn();
  beforeEach(() => { vi.clearAllMocks(); api = installElectronApiMock(); });
  const show = () => render(<SshEnvironmentManager environments={[config]} onSaved={onSaved} onDeleted={onDeleted} onClose={vi.fn()} />);

  it('creates a target with a custom root', async () => {
    api.sshEnvironmentSave.mockImplementation(async (value) => ({ success: true, config: value }));
    show();
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'New Host' } });
    fireEvent.change(screen.getByLabelText('SSH Target'), { target: { value: 'new-host' } });
    fireEvent.change(screen.getByLabelText('Default workspace root (optional)'), { target: { value: '/opt/my projects' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Target' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ label: 'New Host', target: 'new-host', defaultWorkspaceRoot: '/opt/my projects' })));
  });

  it('edits a saved target without changing its identity and allows clearing the root', async () => {
    api.sshEnvironmentSave.mockImplementation(async (value) => ({ success: true, config: value }));
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Host' }));
    expect(screen.getByLabelText('Default workspace root (optional)')).toHaveValue('/srv/repos');
    fireEvent.change(screen.getByLabelText('Default workspace root (optional)'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: config.id, kind: 'ssh', label: config.label, target: config.target }));
  });

  it('rejects relative roots before saving', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Host' }));
    fireEvent.change(screen.getByLabelText('Default workspace root (optional)'), { target: { value: '~/repos' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(screen.getByRole('alert')).toHaveTextContent('absolute POSIX path');
    expect(api.sshEnvironmentSave).not.toHaveBeenCalled();
  });

  it('shows the in-use edit refusal and retains the draft', async () => {
    api.sshEnvironmentSave.mockResolvedValue({ success: false, error: 'Cannot edit an SSH environment while a workspace is using it' });
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Host' }));
    fireEvent.change(screen.getByLabelText('Default workspace root (optional)'), { target: { value: '/opt/projects' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('using it');
    expect(screen.getByLabelText('Default workspace root (optional)')).toHaveValue('/opt/projects');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('reports failed deletion without removing the saved target', async () => {
    api.sshEnvironmentDelete.mockResolvedValue({ success: false, error: 'Target is in use' });
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Host' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Target is in use');
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
