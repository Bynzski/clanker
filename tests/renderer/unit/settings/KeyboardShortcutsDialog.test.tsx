// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import KeyboardShortcutsDialog from '../../../../src/renderer/components/settings/KeyboardShortcutsDialog';
import { dispatchAppKeybinding } from '../../../../src/renderer/lib/keybindingDispatcher';
import { useKeybindingStore } from '../../../../src/renderer/store/keybindingStore';
import { installElectronApiMock } from '../../../setup/electron';
import { sanitizeKeybindingOverrides, type KeybindingOverrides } from '../../../../src/shared/keybindings';

let persisted: KeybindingOverrides;
let setKeybindingOverrides: ReturnType<typeof vi.fn>;

const ks = (code: string, mods: Partial<{ primary: boolean; shift: boolean; alt: boolean }> = {}) =>
  ({ code, primary: false, ctrl: false, shift: false, alt: false, ...mods });

function renderDialog() {
  const onClose = vi.fn();
  const view = render(<KeyboardShortcutsDialog isOpen onClose={onClose} />);
  return { onClose, ...view };
}

const row = (label: string) => screen.getByText(label, { selector: '.keyboard-shortcuts-label' }).closest('li') as HTMLElement;
const pressWindow = (init: KeyboardEventInit) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => { document.body.dispatchEvent(event); });
  return event;
};

describe('KeyboardShortcutsDialog', () => {
  beforeEach(() => {
    persisted = {};
    setKeybindingOverrides = vi.fn(async (next: unknown) => {
      persisted = sanitizeKeybindingOverrides(next);
      return { success: true, overrides: persisted };
    });
    installElectronApiMock({
      getKeybindingOverrides: vi.fn(async () => persisted),
      setKeybindingOverrides,
    });
    useKeybindingStore.setState({ overrides: {}, loaded: true, capturing: false });
  });
  afterEach(() => cleanup());

  it('lists commands by category with their current bindings', () => {
    renderDialog();
    expect(screen.getByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeInTheDocument();
    expect(within(row('Save File')).getByText('Ctrl+S')).toBeInTheDocument();
    expect(within(row('Fit All Panes')).getByText('Ctrl+Alt+F')).toBeInTheDocument();
    expect(within(row('Open Settings')).getByText('Ctrl+,')).toBeInTheDocument();
    expect(within(row('Next Tab')).getByText('Ctrl+Tab')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset All' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset Save File shortcut' })).toBeDisabled();
  });

  it('does not list component-level or CodeMirror keys', () => {
    renderDialog();
    expect(screen.queryByText(/escape/i, { selector: '.keyboard-shortcuts-label' })).not.toBeInTheDocument();
    expect(screen.queryByText(/undo/i)).not.toBeInTheDocument();
  });

  it('filters by label, category and binding', async () => {
    const user = userEvent.setup();
    renderDialog();
    const search = screen.getByRole('searchbox', { name: 'Search shortcuts' });
    await user.type(search, 'zoom');
    expect(screen.getByText('Zoom In')).toBeInTheDocument();
    expect(screen.queryByText('Save File')).not.toBeInTheDocument();
    await user.clear(search);
    await user.type(search, 'Ctrl+S');
    expect(screen.getByText('Save File')).toBeInTheDocument();
    expect(screen.queryByText('Zoom In')).not.toBeInTheDocument();
    await user.clear(search);
    await user.type(search, 'nonsense-xyz');
    expect(screen.getByText('No matching shortcuts.')).toBeInTheDocument();
  });

  it('enters capture mode and saves a valid binding, persisting only the deviation', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Edit Save File shortcut' }));
    expect(screen.getByText('Press desired shortcut…')).toBeInTheDocument();
    expect(useKeybindingStore.getState().capturing).toBe(true);

    pressWindow({ code: 'KeyK', ctrlKey: true, shiftKey: true });

    await waitFor(() => expect(within(row('Save File')).getByText('Ctrl+Shift+K')).toBeInTheDocument());
    expect(setKeybindingOverrides).toHaveBeenCalledWith({ 'editor.save': ks('KeyK', { primary: true, shift: true }) });
    expect(within(row('Save File')).getByText('(changed)')).toBeInTheDocument();
    expect(useKeybindingStore.getState().capturing).toBe(false);
  });

  it('ignores modifier-only presses and keeps waiting', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Edit Save File shortcut' }));
    pressWindow({ code: 'ControlLeft', ctrlKey: true });
    pressWindow({ code: 'ShiftLeft', shiftKey: true });
    expect(screen.getByText('Press desired shortcut…')).toBeInTheDocument();
    expect(setKeybindingOverrides).not.toHaveBeenCalled();
  });

  it('Escape cancels capture without saving and without closing the dialog', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await user.click(screen.getByRole('button', { name: 'Edit Save File shortcut' }));
    pressWindow({ code: 'Escape', key: 'Escape' });
    expect(screen.queryByText('Press desired shortcut…')).not.toBeInTheDocument();
    expect(setKeybindingOverrides).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeInTheDocument();
    expect(within(row('Save File')).getByText('Ctrl+S')).toBeInTheDocument();
  });

  it('Delete clears the binding to an explicit unbind', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Edit Save File shortcut' }));
    pressWindow({ code: 'Delete', key: 'Delete' });
    await waitFor(() => expect(within(row('Save File')).getByText('Unbound')).toBeInTheDocument());
    expect(setKeybindingOverrides).toHaveBeenCalledWith({ 'editor.save': null });
  });

  it('a captured shortcut is consumed and never runs an app command', async () => {
    const user = userEvent.setup();
    const actions = {
      openSettings: vi.fn(), fitAllPanes: vi.fn(), toggleExplorer: vi.fn(), saveActiveEditorFile: vi.fn(), zoomApp: vi.fn(),
    };
    const appListener = (event: KeyboardEvent) => { dispatchAppKeybinding(event, actions); };
    window.addEventListener('keydown', appListener);
    const bubbled = vi.fn();
    document.body.addEventListener('keydown', bubbled);
    try {
      renderDialog();
      await user.click(screen.getByRole('button', { name: 'Edit Open Settings shortcut' }));
      // Ctrl+B is Toggle Explorer's default; it must neither execute nor reach the page.
      const event = pressWindow({ code: 'KeyB', ctrlKey: true });
      expect(event.defaultPrevented).toBe(true);
      expect(actions.toggleExplorer).not.toHaveBeenCalled();
      expect(bubbled).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      // Zoom keys are also swallowed while recording, even though zoom is normally global.
      await user.click(screen.getByRole('button', { name: 'Edit Open Settings shortcut' }));
      const zoom = pressWindow({ code: 'Equal', ctrlKey: true });
      expect(zoom.defaultPrevented).toBe(true);
      expect(actions.zoomApp).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', appListener);
      document.body.removeEventListener('keydown', bubbled);
    }
  });

  describe('conflicts', () => {
    async function startConflict() {
      const user = userEvent.setup();
      renderDialog();
      await user.click(screen.getByRole('button', { name: 'Edit Toggle Explorer shortcut' }));
      pressWindow({ code: 'KeyS', ctrlKey: true }); // Save's default, overlapping (editor) context
      await screen.findByText(/already used by/);
      return user;
    }

    it('shows the conflicting command and changes nothing until confirmed', async () => {
      await startConflict();
      expect(screen.getByRole('alert')).toHaveTextContent('Ctrl+S is already used by Save File');
      expect(setKeybindingOverrides).not.toHaveBeenCalled();
      expect(within(row('Toggle Explorer')).getByText('Ctrl+B')).toBeInTheDocument();
    });

    it('Cancel preserves the previous configuration', async () => {
      const user = await startConflict();
      await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByText(/already used by/)).not.toBeInTheDocument();
      expect(setKeybindingOverrides).not.toHaveBeenCalled();
      expect(within(row('Toggle Explorer')).getByText('Ctrl+B')).toBeInTheDocument();
      expect(within(row('Save File')).getByText('Ctrl+S')).toBeInTheDocument();
    });

    it('Replace explicitly unbinds the conflicting command so its default cannot return', async () => {
      const user = await startConflict();
      await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Replace' }));
      await waitFor(() => expect(within(row('Toggle Explorer')).getByText('Ctrl+S')).toBeInTheDocument());
      expect(within(row('Save File')).getByText('Unbound')).toBeInTheDocument();
      expect(setKeybindingOverrides).toHaveBeenCalledWith({
        'view.toggleExplorer': ks('KeyS', { primary: true }),
        'editor.save': null,
      });
    });

    it('allows the same key in disjoint contexts without prompting', async () => {
      const user = userEvent.setup();
      renderDialog();
      // Browser Refresh (browser) onto Save's key (editor): disjoint.
      await user.click(screen.getByRole('button', { name: 'Edit Refresh shortcut' }));
      pressWindow({ code: 'KeyS', ctrlKey: true });
      await waitFor(() => expect(within(row('Refresh')).getByText('Ctrl+S')).toBeInTheDocument());
      expect(screen.queryByText(/already used by/)).not.toBeInTheDocument();
      expect(within(row('Save File')).getByText('Ctrl+S')).toBeInTheDocument();
    });
  });

  it('resets one command, deleting only its override', async () => {
    const user = userEvent.setup();
    useKeybindingStore.setState({ overrides: {
      'editor.save': ks('KeyK', { primary: true }),
      'zoom.in': ks('KeyJ', { primary: true }),
    } });
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Reset Save File shortcut' }));
    await waitFor(() => expect(within(row('Save File')).getByText('Ctrl+S')).toBeInTheDocument());
    expect(setKeybindingOverrides).toHaveBeenCalledWith({ 'zoom.in': ks('KeyJ', { primary: true }) });
    expect(within(row('Zoom In')).getByText('Ctrl+J')).toBeInTheDocument();
  });

  it('Reset All removes every override', async () => {
    const user = userEvent.setup();
    useKeybindingStore.setState({ overrides: { 'editor.save': null, 'zoom.in': ks('KeyJ', { primary: true }) } });
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Reset All' }));
    await waitFor(() => expect(useKeybindingStore.getState().overrides).toEqual({}));
    expect(setKeybindingOverrides).toHaveBeenCalledWith({});
    expect(within(row('Save File')).getByText('Ctrl+S')).toBeInTheDocument();
  });

  it('shows save failures and leaves state unchanged', async () => {
    const user = userEvent.setup();
    setKeybindingOverrides.mockResolvedValueOnce({ success: false, error: 'disk full' });
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Edit Save File shortcut' }));
    pressWindow({ code: 'KeyK', ctrlKey: true });
    expect(await screen.findByText('disk full')).toBeInTheDocument();
    expect(useKeybindingStore.getState().overrides).toEqual({});
    expect(within(row('Save File')).getByText('Ctrl+S')).toBeInTheDocument();
  });

  it('round-trips through persistence and reload', async () => {
    const user = userEvent.setup();
    const first = renderDialog();
    await user.click(screen.getByRole('button', { name: 'Edit Reset Zoom shortcut' }));
    pressWindow({ code: 'KeyZ', ctrlKey: true, altKey: true });
    await waitFor(() => expect(within(row('Reset Zoom')).getByText('Ctrl+Alt+Z')).toBeInTheDocument());
    first.unmount();

    // New session: nothing cached in the renderer, only what main persisted.
    useKeybindingStore.setState({ overrides: {}, loaded: false });
    await act(async () => { await useKeybindingStore.getState().load(); });
    renderDialog();
    expect(within(row('Reset Zoom')).getByText('Ctrl+Alt+Z')).toBeInTheDocument();
    expect(within(row('Reset Zoom')).getByText('(changed)')).toBeInTheDocument();
  });

  it('resets transient state when closed and reopened', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<KeyboardShortcutsDialog isOpen onClose={() => undefined} />);
    await user.type(screen.getByRole('searchbox', { name: 'Search shortcuts' }), 'zoom');
    await user.click(screen.getByRole('button', { name: 'Edit Zoom In shortcut' }));
    rerender(<KeyboardShortcutsDialog isOpen={false} onClose={() => undefined} />);
    expect(useKeybindingStore.getState().capturing).toBe(false);
    rerender(<KeyboardShortcutsDialog isOpen onClose={() => undefined} />);
    expect(screen.getByRole('searchbox', { name: 'Search shortcuts' })).toHaveValue('');
    expect(screen.queryByText('Press desired shortcut…')).not.toBeInTheDocument();
  });

  it('clicking Close calls onClose', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await user.click(screen.getByRole('button', { name: 'Close Keyboard Shortcuts' }));
    expect(onClose).toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'x' });
  });
});
