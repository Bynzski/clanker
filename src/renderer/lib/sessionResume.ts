import type { HarnessSession, SessionInvokeOptions, SessionInvokeResult } from '../../shared/types/session';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useAssistantNavStore } from '../store/assistantNavStore';
import { paneIsPresented } from '../store/workspacePages';
import { waitForTerminalPaneGeometry, clearTerminalPaneGeometry } from './terminalPaneGeometry';

/** Reserve the actual destination split and measure its xterm before main can start a native TUI. */
export async function resumeSessionInMeasuredPane(params: {
  workspaceId: string;
  workspacePath: string;
  environmentId: string;
  session: HarnessSession;
  fork?: boolean;
  options?: SessionInvokeOptions;
  signal?: AbortSignal;
}): Promise<SessionInvokeResult> {
  const { workspaceId, workspacePath, environmentId, session, signal } = params;
  const liveWorkspace = () => {
    const state = useWorkspaceStore.getState();
    const workspace = state.getWorkspaceById(workspaceId);
    return workspace?.workspacePath === workspacePath && (workspace.environmentId ?? 'local') === environmentId ? workspace : null;
  };
  const pageId = liveWorkspace()?.activePageId;
  const mayStart = () => !signal?.aborted && liveWorkspace() && liveWorkspace()?.activePageId === pageId && useWorkspaceStore.getState().activeWorkspaceId === workspaceId
    && !useAssistantNavStore.getState().activeAssistantId;
  if (!mayStart()) throw new Error('The workspace is no longer active');
  const paneId = useWorkspaceStore.getState().addPane(null, undefined, workspaceId);
  if (!paneId) throw new Error('Could not reserve a resume pane');
  let attached = false;
  const measurement = new AbortController();
  const abortMeasurement = () => measurement.abort();
  signal?.addEventListener('abort', abortMeasurement, { once: true });
  const unsubscribeMeasurement = useWorkspaceStore.subscribe(() => {
    const workspace = liveWorkspace();
    if (!mayStart() || !availablePane() || (workspace?.pages && !paneIsPresented(workspace, paneId))) abortMeasurement();
  });
  const unsubscribeAssistant = useAssistantNavStore.subscribe(() => { if (!mayStart()) abortMeasurement(); });
  const availablePane = () => liveWorkspace()?.panes.some((pane) => pane.id === paneId && pane.terminalId === null);
  try {
    const initialGeometry = await waitForTerminalPaneGeometry(paneId, measurement.signal);
    unsubscribeMeasurement();
    unsubscribeAssistant();
    if (!mayStart() || !availablePane()) throw new Error('The resume pane is no longer available');
    const result = await window.electronAPI.invokeSession(workspaceId, session, params.fork ?? false, {
      ...params.options, initialGeometry,
    });
    if ('recreateOffer' in result) {
      if (!availablePane()) throw new Error('The workspace closed while resuming');
      return result;
    }
    try {
      // Once dispatched, a live original workspace may receive its terminal in the background.
      // Closing the dropdown cancels measurement, not an already accepted native launch.
      if (!availablePane()) throw new Error('The workspace closed or changed while resuming');
      const store = useWorkspaceStore.getState();
      if (result.checkoutContext && !store.upsertCheckoutContext(workspaceId, result.checkoutContext)) {
        throw new Error('The checkout this conversation ran in could not be attached to the workspace');
      }
      store.addTerminal({
        id: result.id, pid: result.pid, workspaceId, environmentId,
        workingDir: result.workingDir ?? result.checkoutContext?.path ?? workspacePath,
        harnessId: result.harnessId ?? session.harness, attention: result.attention, attentionEnabled: result.attentionEnabled === true,
        ...(result.checkoutContextId ? { checkoutContextId: result.checkoutContextId } : {}),
      }, workspaceId, paneId, pageId);
      const recorded = useWorkspaceStore.getState().getWorkspaceById(workspaceId);
      if (!recorded?.terminals.some((terminal) => terminal.id === result.id)
        || !recorded.panes.some((pane) => pane.id === paneId && pane.terminalId === result.id)) {
        throw new Error('The resumed terminal could not be recorded');
      }
      attached = true;
      return result;
    } catch (error) {
      await window.electronAPI.killTerminal(result.id).catch((cleanupError) => console.warn('Failed to clean up resumed terminal:', cleanupError));
      throw error;
    }
  } finally {
    unsubscribeMeasurement();
    unsubscribeAssistant();
    signal?.removeEventListener('abort', abortMeasurement);
    clearTerminalPaneGeometry(paneId);
    if (!attached && useWorkspaceStore.getState().getWorkspaceById(workspaceId)?.panes.some((pane) => pane.id === paneId && pane.terminalId === null)) {
      useWorkspaceStore.getState().removePane(paneId, workspaceId);
    }
  }
}
