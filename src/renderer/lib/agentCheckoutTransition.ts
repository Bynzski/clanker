import type { AgentCheckoutTransitionEvent } from '../../shared/types/checkoutTransition';
import { markTerminalDisposed } from './terminalRuntimeCache';
import { useNotificationStore } from '../store/notificationStore';
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
    case 'terminal-checkout-changed': {
      const workspace = store.getWorkspaceById(event.workspaceId);
      const terminal = workspace?.terminals.find((entry) => entry.id === event.terminalId);
      const context = workspace?.checkoutContexts?.find((entry) => entry.id === event.checkoutContextId);
      if (!terminal || !context || context.path !== event.workingDir) return;
      // Same identity: keep the cached xterm, pane, display name and all other live terminal metadata.
      store.replaceTerminal(event.workspaceId, event.terminalId, {
        ...terminal, checkoutContextId: context.id, workingDir: context.path,
      });
      return;
    }
    case 'checkout-released':
      store.removeCheckoutContext(event.workspaceId, event.checkoutContextId);
      return;
    case 'notice':
      useNotificationStore.getState().show({
        workspaceId: event.workspaceId,
        workspaceName: store.getWorkspaceById(event.workspaceId)?.name,
        tone: event.tone,
        message: event.message,
        dedupeKey: `checkout-transition:${event.message}`,
      });
      return;
  }
}
