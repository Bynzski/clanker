import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AssistantRead, AssistantRoutine, AssistantRun } from '../../../src/shared/types/assistantDetails';
import { installElectronApiMock } from '../../setup/electron';
import { useAssistantsStore } from '../../../src/renderer/store/assistantsStore';
import AssistantsSettings from '../../../src/renderer/components/settings/AssistantsSettings';
import { DefaultHermesRoutines } from '../../../src/renderer/components/settings/assistantDetails/DefaultHermesRoutines';
import { AssistantRoutines } from '../../../src/renderer/components/settings/assistantDetails/AssistantRoutines';
import { AssistantRuns } from '../../../src/renderer/components/settings/assistantDetails/AssistantRuns';

const task: AssistantRoutine = { id: 'shared', name: 'Default fixture task', enabled: false, state: 'paused', scheduleKind: 'once', schedule: '2099-01-01', timezone: 'UTC', nextRunAbsent: true, lastRunAbsent: true, recordedRuns: 0, lastResult: 'No result recorded' };
beforeEach(() => { installElectronApiMock(); useAssistantsStore.getState().reset(); });
afterEach(() => { cleanup(); useAssistantsStore.getState().reset(); vi.restoreAllMocks(); });
const expand = () => fireEvent.click(screen.getByText('Default Hermes · Scheduled tasks'));
it('default tasks are lazy and separate from named Assistant routing, even with no named profiles', async () => {
  vi.mocked(window.electronAPI.getAssistants).mockResolvedValue({ available: true, settings: { enabled: true, autoStart: false }, service: { state: 'connected', ownership: 'external' }, assistants: [], profiles: [], surfaces: [] });
  vi.mocked(window.electronAPI.getDefaultHermesRoutines).mockResolvedValue({ state: 'ready', data: [task] });
  vi.mocked(window.electronAPI.getDefaultHermesRoutineRuns).mockResolvedValue({ state: 'ready', data: [] });
  render(<AssistantsSettings />);
  await screen.findByText('Default Hermes · Scheduled tasks'); expect(window.electronAPI.getDefaultHermesRoutines).not.toHaveBeenCalled();
  expand(); expect(await screen.findByText(task.name)).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /default/i })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Inspect recent runs' }));
  expect(await screen.findByText(/No recent execution records available/)).toBeInTheDocument();
  expect(window.electronAPI.getDefaultHermesRoutineRuns).toHaveBeenCalledWith('shared');
  expect(window.electronAPI.getAssistantRoutineRuns).not.toHaveBeenCalled(); expect(window.electronAPI.openAssistant).not.toHaveBeenCalled();
});
it('offline default tasks explain the CLI/service distinction and never start or refresh the service', () => {
  render(<DefaultHermesRoutines connected={false} />); expand();
  expect(screen.getByText(/ordinary Hermes CLI can work independently/)).toBeInTheDocument();
  expect(window.electronAPI.getDefaultHermesRoutines).not.toHaveBeenCalled();
  expect(window.electronAPI.refreshAssistants).not.toHaveBeenCalled(); expect(window.electronAPI.configureAssistants).not.toHaveBeenCalled();
});
it.each(['error', 'unsupported', 'unavailable'] as const)('default %s is not a falsely empty list; explicit refresh recovers', async (state) => {
  vi.mocked(window.electronAPI.getDefaultHermesRoutines).mockResolvedValueOnce({ state }).mockResolvedValue({ state: 'ready', data: [] });
  render(<DefaultHermesRoutines connected />); expand();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh default tasks' })).toBeEnabled());
  expect(screen.queryByText('No scheduled tasks reported for this profile.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh default tasks' }));
  expect(await screen.findByText('No scheduled tasks reported for this profile.')).toBeInTheDocument();
  expect(window.electronAPI.getDefaultHermesRoutines).toHaveBeenCalledTimes(2);
});
it('closing/reopening default disclosure drops old responses and never adds periodic polling', async () => {
  let finish!: (value: AssistantRead<AssistantRoutine[]>) => void;
  vi.mocked(window.electronAPI.getDefaultHermesRoutines).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue({ state: 'ready', data: [] });
  render(<DefaultHermesRoutines connected />); expand();
  await waitFor(() => expect(window.electronAPI.getDefaultHermesRoutines).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: 'Refresh default tasks' })).toBeDisabled();
  expand(); await waitFor(() => expect(document.querySelector('details')).not.toHaveAttribute('open'));
  expand(); await screen.findByText('No scheduled tasks reported for this profile.');
  await act(async () => finish({ state: 'ready', data: [task] })); expect(screen.queryByText(task.name)).toBeNull();
  expect(window.electronAPI.getDefaultHermesRoutines).toHaveBeenCalledTimes(2);
});
it('refresh replaces previously expanded run history and drops its late acknowledgement', async () => {
  let finish!: (value: AssistantRead<AssistantRun[]>) => void;
  vi.mocked(window.electronAPI.getDefaultHermesRoutines).mockResolvedValue({ state: 'ready', data: [task] });
  vi.mocked(window.electronAPI.getDefaultHermesRoutineRuns).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<DefaultHermesRoutines connected />); expand(); await screen.findByText(task.name);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect recent runs' }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh default tasks' })); await screen.findByText(task.name);
  await act(async () => finish({ state: 'ready', data: [{ source: 'cron', startedAt: 100 }] }));
  expect(screen.queryByText('Agent execution record')).toBeNull();
});
it('configuration/counts/nulls are clear without claiming runtime health from future timestamps or background activity', () => {
  render(<AssistantRoutines displayName="Fred" loadRuns={vi.fn()} routines={{ state: 'ready', data: [task, { ...task, id: 'other', name: 'Recurring task', enabled: true, state: 'scheduled', scheduleKind: 'interval', nextRunAbsent: false, nextRun: '2099-01-01T00:00:00Z', latestAttempt: { status: 'running' } }] }} />);
  expect(screen.getByText('One-shot')).toBeInTheDocument(); expect(screen.getByText('Recurring')).toBeInTheDocument();
  expect(screen.getByText('Enabled')).toBeInTheDocument(); expect(screen.getByText('Disabled / paused')).toBeInTheDocument();
  expect(screen.getByText(/Scheduler runtime health: Unknown/)).toBeInTheDocument();
  expect(screen.getByText(/In-progress record \(liveness unverified\)/)).toBeInTheDocument();
  expect(screen.getByText('No next run recorded')).toBeInTheDocument(); expect(screen.getAllByText('No run recorded')).toHaveLength(2);
  expect(screen.queryByText('Running')).toBeNull();
});
it.each(['Succeeded', 'Failed', 'Interrupted', 'Unknown'])('shows the last reported job result %s without assigning it to individual runs', (lastResult) => {
  render(<AssistantRoutines displayName="Fred" loadRuns={vi.fn()} routines={{ state: 'ready', data: [{ ...task, lastResult }] }} />);
  expect(screen.getByText(lastResult)).toBeInTheDocument();
});
it('missing/unowned history differs from an empty response and exposes no output preview', () => {
  const view = render(<AssistantRuns runs={{ state: 'unavailable' }} />);
  expect(screen.getByText(/owning profile; Clanker will not show ambiguous records/)).toBeInTheDocument();
  expect(screen.queryByText(/No recent execution records/)).toBeNull();
  view.rerender(<AssistantRuns runs={{ state: 'ready', data: [{ source: 'cron', startedAt: 100, endedAt: 101 }] }} />);
  expect(screen.getByText('Unknown — no structured per-run result reported')).toBeInTheDocument();
  expect(screen.getByText(/ended session does not prove success/)).toBeInTheDocument(); expect(screen.queryByLabelText('Hermes output preview')).toBeNull();
});
