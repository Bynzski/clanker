import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AssistantDetails, AssistantRead, AssistantRun } from '../../../src/shared/types/assistantDetails';
import { installElectronApiMock } from '../../setup/electron';
import { useAssistantsStore } from '../../../src/renderer/store/assistantsStore';
import AssistantProfileDetail from '../../../src/renderer/components/settings/AssistantProfileDetail';

const fred = { id: 'hermes:fred', displayName: 'Fred' };
const beta = { id: 'hermes:beta', displayName: 'Beta' };
const details = (id: string): AssistantDetails => ({ assistantId: id, profile: { state: 'ready', data: {} }, history: { state: 'ready', data: [] },
  routines: { state: 'ready', data: [{ id: 'shared', name: `${id} task`, enabled: false, state: 'paused' }] } });
const appearance = (id: string, title = id) => ({ assistantId: id, cosmetics: { state: 'ready' as const, data: { title, tagline: '', editToken: 'opaque' } } });
beforeEach(() => {
  installElectronApiMock(); useAssistantsStore.getState().reset();
  const snapshot = { available: true, settings: { enabled: true, autoStart: false }, service: { state: 'connected' as const, ownership: 'external' as const }, assistants: [fred, beta], surfaces: [] };
  useAssistantsStore.setState({ snapshot });
  vi.mocked(window.electronAPI.refreshAssistants).mockResolvedValue(snapshot);
  vi.mocked(window.electronAPI.getAssistantDetails).mockImplementation(async (id) => details(id));
  vi.mocked(window.electronAPI.getAssistantPresentation).mockImplementation(async (id) => appearance(id));
});
afterEach(() => { cleanup(); useAssistantsStore.getState().reset(); vi.restoreAllMocks(); });

it.each(['Refresh details', 'Reload values'])('%s sequences one native refresh before both cron and appearance reloads', async (button) => {
  let finish!: (value: Awaited<ReturnType<typeof window.electronAPI.refreshAssistants>>) => void;
  vi.mocked(window.electronAPI.refreshAssistants).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<AssistantProfileDetail assistant={fred} connected />);
  await screen.findByText(`${fred.id} task`); await waitFor(() => expect(screen.getByLabelText('Bot title')).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: button }));
  expect(window.electronAPI.refreshAssistants).toHaveBeenCalledOnce();
  expect(window.electronAPI.getAssistantDetails).toHaveBeenCalledOnce();
  expect(window.electronAPI.getAssistantPresentation).toHaveBeenCalledOnce();
  vi.mocked(window.electronAPI.getAssistantPresentation).mockResolvedValue(appearance(fred.id, 'Authoritative title'));
  await act(async () => finish(useAssistantsStore.getState().snapshot!));
  await waitFor(() => expect(window.electronAPI.getAssistantDetails).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByLabelText('Bot title')).toHaveValue('Authoritative title'));
  expect(window.electronAPI.getAssistantPresentation).toHaveBeenCalledTimes(2);
  expect(window.electronAPI.refreshAssistants).toHaveBeenCalledOnce();
  expect(screen.getByText(`${fred.id} task`)).toBeInTheDocument();
  expect(screen.getByText(/runtime health: Unknown/)).toBeInTheDocument();
  expect(window.electronAPI.openAssistant).not.toHaveBeenCalled();
});

it('saving cosmetics preserves pending cron history and does not rebase it or re-read details', async () => {
  let finish!: (value: AssistantRead<AssistantRun[]>) => void;
  vi.mocked(window.electronAPI.getAssistantRoutineRuns).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  vi.mocked(window.electronAPI.updateAssistantPresentation).mockResolvedValue({ state: 'saved', presentation: appearance(fred.id, 'New title') });
  render(<AssistantProfileDetail assistant={fred} connected />);
  await screen.findByText(`${fred.id} task`); await waitFor(() => expect(screen.getByLabelText('Bot title')).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Inspect recent runs' }));
  fireEvent.change(screen.getByLabelText('Bot title'), { target: { value: 'New title' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save appearance' }));
  await screen.findByText('Saved in Hermes.');
  await act(async () => finish({ state: 'ready', data: [{ source: 'cron', startedAt: 100 }] }));
  expect(await screen.findByText('Agent execution record')).toBeInTheDocument();
  expect(screen.getByLabelText('Bot title')).toHaveValue('New title');
  expect(window.electronAPI.getAssistantDetails).toHaveBeenCalledOnce();
  expect(window.electronAPI.refreshAssistants).not.toHaveBeenCalled();
});

it('a late refresh from the previous Assistant cannot reset the next Assistant draft or cron view', async () => {
  let finish!: (value: Awaited<ReturnType<typeof window.electronAPI.refreshAssistants>>) => void;
  vi.mocked(window.electronAPI.refreshAssistants).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(<AssistantProfileDetail assistant={fred} connected />);
  await screen.findByText(`${fred.id} task`); fireEvent.click(screen.getByRole('button', { name: 'Refresh details' }));
  view.rerender(<AssistantProfileDetail assistant={beta} connected />);
  await screen.findByText(`${beta.id} task`); await waitFor(() => expect(screen.getByLabelText('Bot title')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Bot title'), { target: { value: 'Unsaved Beta draft' } });
  await act(async () => finish(useAssistantsStore.getState().snapshot!));
  expect(screen.getByLabelText('Bot title')).toHaveValue('Unsaved Beta draft');
  expect(screen.getByText(`${beta.id} task`)).toBeInTheDocument(); expect(screen.queryByText(`${fred.id} task`)).toBeNull();
  expect(window.electronAPI.getAssistantDetails).toHaveBeenCalledTimes(2);
  expect(window.electronAPI.getAssistantPresentation).toHaveBeenCalledTimes(2);
});
