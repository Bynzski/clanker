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
// sessionStorage survives renderer reload, not app restart. A time seed also
// avoids replaying epochs when storage is unavailable; selection remains runtime-only.
const EPOCH_KEY = 'clanker-grid:browser-presentation-epoch';
let epoch = Date.now() * 1024;
try {
  const saved = Number(window.sessionStorage.getItem(EPOCH_KEY));
  if (Number.isSafeInteger(saved) && saved >= 0 && saved < Number.MAX_SAFE_INTEGER - 1) epoch = Math.max(epoch, saved);
} catch { /* Storage is optional; no Browser resource state is persisted here. */ }
let current: PresentedBrowser | null = null;
const listeners = new Set<() => void>();
function publish() { for (const listener of listeners) listener(); }
/** Called only by BrowserLifecycleCoordinator. Components consume, never mint, leases. */
export function setBrowserPresentation(ownerId: string | null, paneId?: string, tabId?: string): PresentedBrowser | null {
  if (current?.ownerId === ownerId && current?.lease.paneId === paneId && current?.tabId === tabId) return current;
  const outgoing = current;
  current = ownerId && paneId && tabId ? { ownerId, tabId, lease: { paneId, epoch: ++epoch }, ready: false } : null;
  if (current) {
    try { window.sessionStorage.setItem(EPOCH_KEY, String(epoch)); } catch { /* Optional reload fencing. */ }
  }
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

export function browserResourceExists(ownerId: string, paneId: string, tabId: string): boolean {
  const assistantId = assistantIdFromBrowserOwner(ownerId);
  if (assistantId) return paneId === ownerId && Boolean(useAssistantSurfaceStore.getState().byId[assistantId]?.tabs.some((tab) => tab.id === tabId));
  const workspace = useWorkspaceStore.getState().getWorkspaceById(ownerId);
  return Boolean(workspace?.pages ? workspace.pages.some((page) => page.browser?.pane?.id === paneId && page.browser.pane.tabs.some((tab) => tab.id === tabId))
    : workspace?.browserPane?.id === paneId && workspace.browserPane.tabs.some((tab) => tab.id === tabId));
}

/** Native existence, not React mounting, determines whether startup navigation is necessary. */
export async function ensureBrowserResource(ownerId: string, paneId: string, tabId: string, url: string, isValid = () => true): Promise<void> {
  const tabs = await window.electronAPI.browserGetTabs(ownerId, paneId);
  if (!isValid() || tabs.some((tab) => tab.tabId === tabId)) return;
  await window.electronAPI.browserCreateTab(ownerId, tabId, paneId);
  if (isValid() && url && url !== 'https://github.com') await window.electronAPI.browserTabNavigate(ownerId, tabId, url);
}
