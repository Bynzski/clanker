import type { Terminal } from '@xterm/xterm';

/** Shared copy-on-select and explicit copy semantics for workspace and Assistant terminals. */
export function registerTerminalClipboard(terminal: Terminal, isInteractive: () => boolean) {
  const copySelection = () => {
    if (!isInteractive() || !terminal.hasSelection()) return;
    const selection = terminal.getSelection();
    if (selection) void window.electronAPI.writeClipboard(selection).catch(console.error);
  };
  const selection = terminal.onSelectionChange(copySelection);
  return {
    dispose: () => selection.dispose(),
    /** Return true only for the copy shortcut, which must never reach the PTY. */
    handleKeyEvent(event: KeyboardEvent): boolean {
      if (!event.ctrlKey || !event.shiftKey || event.key.toLowerCase() !== 'c') return false;
      event.preventDefault();
      if (isInteractive() && event.type === 'keydown') {
        copySelection();
        terminal.clearSelection();
      }
      return true;
    },
  };
}
