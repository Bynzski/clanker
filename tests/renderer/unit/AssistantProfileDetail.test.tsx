import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installElectronApiMock } from '../../setup/electron';
import type { AssistantDetails } from '../../../src/shared/types/assistantDetails';
import { useAssistantsStore } from '../../../src/renderer/store/assistantsStore';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import AssistantsSettings from '../../../src/renderer/components/settings/AssistantsSettings';
import AssistantProfileDetail from '../../../src/renderer/components/settings/AssistantProfileDetail';
import { openAssistantSettings, registerAssistantSettingsHandler } from '../../../src/renderer/lib/settingsHandoff';

const fred = { id: 'hermes:fred', displayName: 'Fred', activity: { model: 'roster-model', skillCount: 2, workerLastActive: 100 } };
const reviewer = { id: 'hermes:reviewer', displayName: 'Reviewer' };
const details = (id: string): AssistantDetails => ({ assistantId: id, profile: { state: 'ready', data: { model: `${id}-model`, provider: 'provider', skills: [{ name: 'review', enabled: true }], toolsets: [], mcpServers: [] } }, history: { state: 'ready', data: [] }, routines: { state: 'ready', data: [{ id: 'job_1', name: `${id}-routine`, enabled: false, state: 'paused' }] } });
beforeEach(() => {
  installElectronApiMock(); useAssistantsStore.getState().reset();
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null });
  vi.mocked(window.electronAPI.getAssistants).mockResolvedValue({ available: true, settings: { enabled: true, autoStart: false }, service: { state: 'connected', ownership: 'external' }, assistants: [fred, reviewer], surfaces: [] });
  vi.mocked(window.electronAPI.getAssistantDetails).mockImplementation(async (id) => details(id));
});
afterEach(() => { cleanup(); useAssistantsStore.getState().reset(); vi.restoreAllMocks(); });
it('uses the existing Settings page lazily with zero workspaces and a selected profile', async () => {
  render(<AssistantsSettings initialAssistantId={fred.id} />);
  expect(await screen.findByRole('combobox', { name: 'Profile' })).toHaveValue(fred.id);
  expect(await screen.findByText(/hermes:fred-model/)).toBeInTheDocument();
  expect(window.electronAPI.getAssistantDetails).toHaveBeenCalledTimes(1);
  expect(window.electronAPI.getAssistantRoutineRuns).not.toHaveBeenCalled();
  expect(screen.getByText(/not proof of a running foreground turn/)).toBeInTheDocument();
  expect(screen.getByText('Skills · 1 enabled / 1 installed')).toBeInTheDocument();
  expect(window.electronAPI.openAssistant).not.toHaveBeenCalled();
});
it('rejects out-of-order profile results after changing selection', async () => {
  let finish!: (value: AssistantDetails) => void;
  vi.mocked(window.electronAPI.getAssistantDetails).mockImplementation((id) => id === fred.id ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve(details(id)));
  render(<AssistantsSettings initialAssistantId={fred.id} />);
  await waitFor(() => expect(window.electronAPI.getAssistantDetails).toHaveBeenCalledWith(fred.id));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: reviewer.id } });
  expect(await screen.findByText(/hermes:reviewer-model/)).toBeInTheDocument();
  await act(async () => { finish(details(fred.id)); });
  expect(screen.queryByText(/hermes:fred-model/)).toBeNull();
  expect(screen.getByText('hermes:reviewer-routine')).toBeInTheDocument();
});
it('shows unsupported/error separately from empty, and never manufactures run success', async () => {
  vi.mocked(window.electronAPI.getAssistantDetails).mockResolvedValue({ ...details(fred.id), profile: { state: 'unsupported' }, history: { state: 'error' } });
  vi.mocked(window.electronAPI.getAssistantRoutineRuns).mockResolvedValue({ state: 'ready', data: [{ title: 'Output only', source: 'cron_output', startedAt: 100, endedAt: 100, preview: 'Bounded preview' }] });
  render(<AssistantProfileDetail assistant={fred} connected />);
  expect(await screen.findByText('Not supported by this Hermes version.')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Could not read from Hermes');
  expect(screen.getByText(/Disabled \/ paused/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Inspect recent runs' }));
  expect(await screen.findByText('Output only')).toBeInTheDocument();
  expect(screen.getByText(/ended session does not prove success/)).toBeInTheDocument();
  expect(screen.getByText('Bounded preview')).toBeInTheDocument();
  expect(window.electronAPI.getAssistantRoutineRuns).toHaveBeenCalledWith(fred.id, 'job_1');
});
it('shows routine failures, offline and empty states truthfully', async () => {
  vi.mocked(window.electronAPI.getAssistantDetails).mockResolvedValue({ ...details(fred.id), routines: { state: 'error' } });
  const view = render(<AssistantProfileDetail assistant={fred} connected />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not read from Hermes');
  expect(screen.queryByText(/No scheduled tasks/)).toBeNull();
  view.rerender(<AssistantProfileDetail assistant={fred} connected={false} />);
  expect(screen.getByRole('status')).toHaveTextContent('Offline');
  expect(screen.queryByText(/hermes:fred-model/)).toBeNull();
  view.unmount();
  vi.mocked(window.electronAPI.getAssistantDetails).mockResolvedValue({ ...details(fred.id), routines: { state: 'ready', data: [] } });
  render(<AssistantProfileDetail assistant={fred} connected />);
  expect(await screen.findByText('No scheduled tasks reported for this profile.')).toBeInTheDocument();
});
it('routes a contextual deep-link with its focus-return trigger, without opening or retargeting a chat', () => {
  const handler = vi.fn(); const unregister = registerAssistantSettingsHandler(handler);
  const trigger = document.createElement('button');
  expect(openAssistantSettings(fred.id, trigger)).toBe(true);
  expect(handler).toHaveBeenCalledWith(fred.id, trigger);
  expect(window.electronAPI.openAssistant).not.toHaveBeenCalled();
  unregister(); expect(openAssistantSettings(fred.id, trigger)).toBe(false);
});
