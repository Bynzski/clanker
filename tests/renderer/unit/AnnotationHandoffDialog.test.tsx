// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AnnotationHandoffDialog from '../../../src/renderer/components/AnnotationHandoffDialog';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useAgentAttentionStore } from '../../../src/renderer/store/agentAttentionStore';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';

describe('AnnotationHandoffDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installElectronApiMock();
    useWorkspaceStore.setState({
      workspaces: [createWorkspaceFixture({
        id: 'workspace-1',
        name: 'build-it',
        workspacePath: '/projects/build-it',
        terminals: [{ id: 'term-1', pid: 1, workingDir: '/projects/build-it', harnessId: 'codex', attentionEnabled: true, displayName: 'Samson' }],
        panes: [{ id: 'pane-1', terminalId: 'term-1' }],
      })],
      activeWorkspaceId: 'workspace-1',
    });
    useAgentAttentionStore.setState({ byTerminalId: {
      'term-1': { lifecycle: 'turn_complete', unseen: false, updatedAt: Date.now() },
    } });
  });

  afterEach(() => cleanup());

  it('sends the reviewed message to the selected named agent', async () => {
    function Host() {
      const [open, setOpen] = useState(true);
      return open ? <AnnotationHandoffDialog sourceWorkspaceId="workspace-1" initialMessage="Original annotation" onClose={() => setOpen(false)} /> : null;
    }
    render(<Host />);
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Edited annotation' } });
    expect(screen.getByText(/Samson/)).toBeTruthy();
    expect(await screen.findByText(/build-it · Ready/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(window.electronAPI.sendAnnotationToAgent).toHaveBeenCalledWith('workspace-1', 'term-1', 'Edited annotation'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Send annotation to agent' })).toBeNull());
  });

  it('keeps the edited message available for copying when the target becomes stale', async () => {
    vi.mocked(window.electronAPI.sendAnnotationToAgent).mockResolvedValue({ success: false, error: 'The agent is no longer ready. Copy the message instead.' });
    const onClose = vi.fn();
    render(<AnnotationHandoffDialog sourceWorkspaceId="workspace-1" initialMessage="Original annotation" onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Edited annotation' } });
    await screen.findByText(/build-it · Ready/);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('status')).toHaveTextContent('The agent is no longer ready');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }));
    await waitFor(() => expect(window.electronAPI.writeClipboard).toHaveBeenCalledWith('Edited annotation'));
  });

  it('does not offer automatic send for a permission prompt', async () => {
    vi.mocked(window.electronAPI.getAgentHandoffStatuses).mockResolvedValue({ 'term-1': 'needs_input' });
    render(<AnnotationHandoffDialog sourceWorkspaceId="workspace-1" initialMessage="Annotation" onClose={vi.fn()} />);
    expect(await screen.findByText(/build-it · Needs input/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Copy message' })).toBeEnabled();
  });

  it('allows an open agent when optional attention tracking is off', async () => {
    vi.mocked(window.electronAPI.getAgentHandoffStatuses).mockResolvedValue({ 'term-1': 'unverified' });
    useWorkspaceStore.setState((state) => ({
      workspaces: state.workspaces.map((workspace) => ({
        ...workspace,
        terminals: workspace.terminals.map((terminal) => ({ ...terminal, attentionEnabled: false })),
      })),
    }));
    render(<AnnotationHandoffDialog sourceWorkspaceId="workspace-1" initialMessage="Annotation" onClose={vi.fn()} />);
    expect(await screen.findByText(/status unverified/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });
});
