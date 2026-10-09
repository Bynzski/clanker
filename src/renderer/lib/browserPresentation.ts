import { useSyncExternalStore } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useAssistantNavStore } from '../store/assistantNavStore';
import { useAssistantSurfaceStore } from '../store/assistantSurfaceStore';
import { assistantIdFromBrowserOwner } from '../../shared/browserOwner';
import { workspaceBrowserPresented } from '../store/workspacePages';
import type { BrowserPresentation } from '../../shared/types/browserPresentation';

export interface PresentedBrowser {
  ownerId: string;
  tabId: string;
  lease: BrowserPresentation;
  ready: boolean;
}
let epoch = 0;
let current: PresentedBrowser | null = null;
const listeners = new Set<() => void>();
function publish() { for (const listener of listeners) listener(); }
/** Called only by BrowserLifecycleCoordinator. Components consume, never mint, leases. */
export function setBrowserPresentation(ownerId: string | null, paneId?: string, tabId?: string): PresentedBrowser | null {
  if (current?.ownerId === ownerId && current?.lease.paneId === paneId && current?.tabId === tabId) return current;
  const outgoing = current;
  current = ownerId && paneId && tabId ? { ownerId, tabId, lease: { paneId, epoch: ++epoch }, ready: false } : null;
  if (outgoing) void window.electronAPI.browserHide(outgoing.ownerId, outgoing.lease);
  publish();
  return current;
}
export function markBrowserPresentationReady(presentation: PresentedBrowser): void {
  if (current !== presentation || currentBrowserPresentation(presentation.ownerId) !== presentation) return;
  current = { ...presentation, ready: true };
  publish();
}
export function currentBrowserPresentation(ownerId: string, paneId?: string, tabId?: string): PresentedBrowser | null {
  const assistantId = assistantIdFromBrowserOwner(ownerId);
  if (assistantId) {
    const ui = useAssistantSurfaceStore.getState().byId[assistantId];
    if (useAssistantNavStore.getState().activeAssistantId !== assistantId || !ui?.browserVisible || ui.browserOverlayCount
      || ui.activeTabId !== current?.tabId) return null;
  } else {
    const state = useWorkspaceStore.getState();
    const workspace = state.getWorkspaceById(ownerId);
    if (state.activeWorkspaceId !== ownerId || useAssistantNavStore.getState().activeAssistantId || !workspace
      || !workspaceBrowserPresented(workspace) || workspace.browserOverlayCount
      || workspace.browserPane?.id !== current?.lease.paneId || workspace.browserPane?.activeTabId !== current?.tabId) return null;
  }
  return current?.ownerId === ownerId && (!paneId || current.lease.paneId === paneId)
    && (!tabId || current.tabId === tabId) ? current : null;
}
export function useBrowserPresentation(ownerId: string, paneId?: string, tabId?: string): PresentedBrowser | null {
  const presentation = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => current);
  return presentation?.ownerId === ownerId && (!paneId || presentation.lease.paneId === paneId)
    && (!tabId || presentation.tabId === tabId) ? presentation : null;
}

/** Native existence, not React mounting, determines whether startup navigation is necessary. */
export async function ensureBrowserResource(ownerId: string, paneId: string, tabId: string, url: string, isValid = () => true): Promise<void> {
  const tabs = await window.electronAPI.browserGetTabs(ownerId, paneId);
  if (!isValid() || tabs.some((tab) => tab.tabId === tabId)) return;
  await window.electronAPI.browserCreateTab(ownerId, tabId, paneId);
  if (isValid() && url && url !== 'https://github.com') await window.electronAPI.browserTabNavigate(ownerId, tabId, url);
}
