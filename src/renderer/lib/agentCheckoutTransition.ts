import type { AgentCheckoutTransitionEvent } from '../../shared/types/checkoutTransition';
import { markTerminalDisposed } from '../components/TerminalPane';
import { useCheckoutNoticeStore } from '../store/checkoutNoticeStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { Terminal } from '../store/workspaceTypes';

/**
 * Applies a checkout transition main performed. Main is the authority: it has already moved the
 * conversation, registered or released the checkout and retired the old process. This only makes the
 * renderer's descriptive state say the same, so the pane, the sidebar and the status bar follow the
 * terminal's real checkout. Nothing here can start, confirm or alter a transition.
 */
export function applyAgentCheckoutTransition(event: AgentCheckoutTransitionEvent): void {
  const store = useWorkspaceStore.getState();
  switch (event.kind) {
    case 'checkout-attached':
      store.upsertCheckoutContext(event.workspaceId, event.checkoutContext);
      return;
    case 'terminal-replaced': {
      const workspace = store.getWorkspaceById(event.workspaceId);
      const previous = workspace?.terminals.find((terminal) => terminal.id === event.previousTerminalId);
      const replacement: Terminal = {
        id: event.terminal.id,
        pid: event.terminal.pid,
        workingDir: event.terminal.workingDir,
        workspaceId: event.workspaceId,
        checkoutContextId: event.terminal.checkoutContextId,
        environmentId: event.terminal.environmentId,
        harnessId: event.terminal.harnessId,
        attentionEnabled: event.terminal.attentionEnabled,
      };
      // Dispose the old terminal's xterm first (as every close does) so the pane builds the new one.
      if (previous) markTerminalDisposed(event.previousTerminalId);
      if (!store.replaceTerminal(event.workspaceId, event.previousTerminalId, replacement)) {
        // The pane is gone (closed meanwhile): the replacement would run untracked, so close it like
        // any terminal that never reached its workspace.
        void window.electronAPI.killTerminal(event.terminal.id).catch(() => undefined);
      }
      return;
    }
    case 'checkout-released':
      store.removeCheckoutContext(event.workspaceId, event.checkoutContextId);
      return;
    case 'notice':
      useCheckoutNoticeStore.getState().show({ workspaceId: event.workspaceId, tone: event.tone, message: event.message });
      return;
  }
}
