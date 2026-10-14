import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AssistantAvatar as AvatarResult, AssistantPresentation, AssistantPresentationWriteResult } from '../../../src/shared/types/assistantPresentation';
import { installElectronApiMock } from '../../setup/electron';
import { useAssistantsStore } from '../../../src/renderer/store/assistantsStore';
import { AssistantAppearance } from '../../../src/renderer/components/settings/assistantDetails/AssistantAppearance';
import AssistantAvatar from '../../../src/renderer/components/assistants/AssistantAvatar';
import AssistantsRoster from '../../../src/renderer/components/assistants/AssistantsRoster';

const fred = 'hermes:fred'; const beta = 'hermes:beta';
const presentation = (id = fred, title = 'Native title', tagline = 'Native tagline', editToken: string | undefined = 'opaque-edit'):
  AssistantPresentation => ({ assistantId: id, cosmetics: { state: 'ready', data: { title, tagline, ...(editToken ? { editToken } : {}) } } });
const image: AvatarResult = { state: 'ready', data: { dataUrl: 'data:image/png;base64,aW1hZ2U=', width: 32, height: 32 } };
beforeEach(() => {
  installElectronApiMock(); useAssistantsStore.getState().reset();
  vi.mocked(window.electronAPI.getAssistantPresentation).mockImplementation(async (id) => presentation(id));
  vi.mocked(window.electronAPI.getAssistantAvatar).mockResolvedValue(image);
  useAssistantsStore.setState({ snapshot: { available: true, settings: { enabled: true, autoStart: false }, service: { state: 'connected', ownership: 'external' },
    presentationRevision: 1, assistants: [{ id: fred, displayName: 'Native title' }], surfaces: [] } });
});
afterEach(() => { cleanup(); useAssistantsStore.getState().reset(); vi.restoreAllMocks(); });
const open = () => render(<AssistantAppearance assistantId={fred} connected revision={0} />);

it('reads selected native cosmetics, displays source identity/avatar and writes only title/tagline with the opaque baseline', async () => {
  vi.mocked(window.electronAPI.updateAssistantPresentation).mockResolvedValue({ state: 'saved', presentation: presentation(fred, 'New title', 'New tagline', 'new-edit') });
  open();
  expect(await screen.findByLabelText('Bot title')).toHaveValue('Native title');
  await waitFor(() => expect(screen.getByLabelText('Bot title')).toBeEnabled());
  expect(screen.getByText('Local · hermes:fred')).toBeInTheDocument();
  expect(screen.getByText(/operational role description are not changed/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Bot title'), { target: { value: 'New title' } });
  fireEvent.change(screen.getByLabelText('Bot tagline'), { target: { value: 'New tagline' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save appearance' }));
  expect(await screen.findByText('Saved in Hermes.')).toBeInTheDocument();
  expect(window.electronAPI.updateAssistantPresentation).toHaveBeenCalledWith(fred, { editToken: 'opaque-edit', title: 'New title', tagline: 'New tagline' });
  expect(window.electronAPI.openAssistant).not.toHaveBeenCalled();
  expect(window.electronAPI.configureAssistants).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Bot title')).toHaveValue('New title');
  expect(screen.getByRole('button', { name: 'Save appearance' })).toBeDisabled();
  expect(screen.queryByLabelText(/upload/i)).toBeNull();
});
it('keeps older/malformed backend metadata read-only without introducing local aliases', async () => {
  vi.mocked(window.electronAPI.getAssistantPresentation).mockResolvedValue(presentation(fred, 'Native title', 'Native tagline', ''));
  open();
  await waitFor(() => expect(screen.getByLabelText('Bot title')).toHaveValue('Native title'));
  expect(screen.getByLabelText('Bot title')).toBeDisabled(); expect(screen.getByLabelText('Bot tagline')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save appearance' })).toBeDisabled();
  expect(screen.getByText(/metadata revision support/)).toBeInTheDocument();
  expect(window.electronAPI.updateAssistantPresentation).not.toHaveBeenCalled();
});
it.each(['unsupported', 'error', 'unavailable'] as const)('handles %s metadata reads with a disabled editor', async (state) => {
  vi.mocked(window.electronAPI.getAssistantPresentation).mockResolvedValue({ assistantId: fred, cosmetics: { state } });
  open(); await screen.findByText(/metadata revision support/);
  expect(screen.getByRole('button', { name: 'Save appearance' })).toBeDisabled();
});
it('does not silently refresh/rebase a dirty editor when a new roster generation arrives', async () => {
  open(); await waitFor(() => expect(screen.getByLabelText('Bot title')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Bot title'), { target: { value: 'Unsaved draft' } });
  act(() => useAssistantsStore.setState((state) => ({ snapshot: { ...state.snapshot!, presentationRevision: 2, assistants: [{ id: fred, displayName: 'Desktop title' }] } })));
  expect(screen.getByLabelText('Bot title')).toHaveValue('Unsaved draft');
  expect(window.electronAPI.getAssistantPresentation).toHaveBeenCalledTimes(1);
  vi.mocked(window.electronAPI.updateAssistantPresentation).mockResolvedValue({ state: 'conflict', presentation: presentation(fred, 'Desktop title', 'Desktop tagline', 'fresh-edit') });
  fireEvent.click(screen.getByRole('button', { name: 'Save appearance' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('changed concurrently');
  expect(screen.getByLabelText('Bot title')).toHaveValue('Desktop title');
  expect(window.electronAPI.updateAssistantPresentation).toHaveBeenCalledTimes(1);
});
it.each(['error', 'unsupported', 'unavailable'] as const)('reports %s save results and applies only authoritative returned values', async (state) => {
  vi.mocked(window.electronAPI.updateAssistantPresentation).mockResolvedValue({ state, presentation: presentation(fred, 'Still native') });
  open(); await waitFor(() => expect(screen.getByLabelText('Bot title')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Bot title'), { target: { value: 'Attempt' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save appearance' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.getByLabelText('Bot title')).toHaveValue('Still native');
  expect(screen.queryByText('Saved in Hermes.')).toBeNull();
});
it('an unconfirmed write disables saving until explicit authoritative reload, and a disconnect invalidates late writes', async () => {
  let finish!: (result: AssistantPresentationWriteResult) => void;
  vi.mocked(window.electronAPI.updateAssistantPresentation).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const view = open(); await waitFor(() => expect(screen.getByLabelText('Bot title')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Bot title'), { target: { value: 'Attempt' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save appearance' }));
  view.rerender(<AssistantAppearance assistantId={fred} connected={false} revision={0} />);
  await act(async () => finish({ state: 'saved', presentation: presentation(fred, 'Late success') }));
  expect(screen.queryByText('Saved in Hermes.')).toBeNull();
  expect(screen.getByRole('button', { name: 'Save appearance' })).toBeDisabled();
  view.rerender(<AssistantAppearance assistantId={fred} connected revision={0} />);
  await waitFor(() => expect(screen.getByLabelText('Bot title')).toBeEnabled());
  vi.mocked(window.electronAPI.updateAssistantPresentation).mockRejectedValue(new Error('disconnected'));
  fireEvent.change(screen.getByLabelText('Bot title'), { target: { value: 'Attempt again' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save appearance' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not confirm');
  expect(screen.getByRole('button', { name: 'Save appearance' })).toBeDisabled();
  vi.mocked(window.electronAPI.refreshAssistants).mockResolvedValue(useAssistantsStore.getState().snapshot!);
  fireEvent.click(screen.getByRole('button', { name: 'Reload values' }));
  await waitFor(() => expect(screen.getByLabelText('Bot title')).toBeEnabled());
  expect(screen.getByLabelText('Bot title')).toHaveValue('Native title');
});
it('switching selected profiles rejects late cosmetics and late save acknowledgements', async () => {
  let finishRead!: (result: AssistantPresentation) => void;
  vi.mocked(window.electronAPI.getAssistantPresentation).mockImplementation((id) => id === fred ? new Promise((resolve) => { finishRead = resolve; }) : Promise.resolve(presentation(beta, 'Beta')));
  const view = open(); view.rerender(<AssistantAppearance assistantId={beta} connected revision={0} />);
  await waitFor(() => expect(screen.getByLabelText('Bot title')).toHaveValue('Beta'));
  await act(async () => finishRead(presentation(fred, 'Late Fred')));
  expect(screen.getByLabelText('Bot title')).toHaveValue('Beta');
  let finishSave!: (result: AssistantPresentationWriteResult) => void;
  vi.mocked(window.electronAPI.updateAssistantPresentation).mockImplementation(() => new Promise((resolve) => { finishSave = resolve; }));
  fireEvent.change(screen.getByLabelText('Bot title'), { target: { value: 'Beta draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save appearance' }));
  vi.mocked(window.electronAPI.getAssistantPresentation).mockResolvedValue(presentation(fred, 'Fred'));
  view.rerender(<AssistantAppearance assistantId={fred} connected revision={0} />);
  await waitFor(() => expect(screen.getByLabelText('Bot title')).toHaveValue('Fred'));
  await act(async () => finishSave({ state: 'saved', presentation: presentation(beta, 'Late Beta') }));
  expect(screen.getByLabelText('Bot title')).toHaveValue('Fred'); expect(screen.queryByText('Saved in Hermes.')).toBeNull();
});
it('avatar selection/revision switches discard late image reads and offline profiles fetch nothing', async () => {
  let finish!: (value: AvatarResult) => void;
  vi.mocked(window.electronAPI.getAssistantAvatar).mockImplementation((id) => id === fred ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve({ state: 'ready', data: null }));
  const view = render(<AssistantAvatar assistantId={fred} connected />);
  view.rerender(<AssistantAvatar assistantId={beta} connected />);
  await act(async () => finish(image));
  expect(view.container.querySelector('img')).toBeNull();
  vi.mocked(window.electronAPI.getAssistantAvatar).mockClear();
  view.rerender(<AssistantAvatar assistantId={beta} connected={false} />);
  expect(window.electronAPI.getAssistantAvatar).not.toHaveBeenCalled();
});
it('an older avatar generation cannot replace a newer missing-avatar result', async () => {
  let finish!: (value: AvatarResult) => void;
  vi.mocked(window.electronAPI.getAssistantAvatar).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValue({ state: 'ready', data: null });
  const view = render(<AssistantAvatar assistantId={fred} connected />);
  act(() => useAssistantsStore.setState((state) => ({ snapshot: { ...state.snapshot!, presentationRevision: 2 } })));
  await waitFor(() => expect(window.electronAPI.getAssistantAvatar).toHaveBeenCalledTimes(2));
  await act(async () => finish(image));
  expect(view.container.querySelector('img')).toBeNull();
});
it.each([{ state: 'ready', data: null }, { state: 'error' }, { state: 'unsupported' }, { state: 'ready', data: { dataUrl: 'https://untrusted/avatar.svg', width: 32, height: 32 } }] as AvatarResult[])('uses a neutral fallback for %j art', async (value) => {
  vi.mocked(window.electronAPI.getAssistantAvatar).mockResolvedValue(value);
  const view = render(<AssistantAvatar assistantId={fred} connected />);
  await waitFor(() => expect(window.electronAPI.getAssistantAvatar).toHaveBeenCalledWith(fred));
  expect(view.container.querySelector('img')).toBeNull(); expect(view.container.querySelector('.lucide-user-round')).not.toBeNull();
});
it('visible roster rows use normalized native avatars, handle decoding failure and refresh on a newer generation', async () => {
  const view = render(<AssistantsRoster />);
  await waitFor(() => expect(view.container.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,aW1hZ2U='));
  fireEvent.error(view.container.querySelector('img')!);
  expect(view.container.querySelector('img')).toBeNull();
  act(() => useAssistantsStore.setState((state) => ({ snapshot: { ...state.snapshot!, presentationRevision: 2 } })));
  await waitFor(() => expect(view.container.querySelector('img')).not.toBeNull());
  expect(window.electronAPI.getAssistantAvatar).toHaveBeenCalledTimes(2);
});
