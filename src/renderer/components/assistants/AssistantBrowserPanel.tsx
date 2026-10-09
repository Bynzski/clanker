import { useMemo } from 'react';
import { currentBrowserPresentation } from '../../lib/browserPresentation';
import { BrowserPanelCore, type BrowserPanelModel } from '../BrowserPanel';
import { useAssistantSurfaceStore } from '../../store/assistantSurfaceStore';
import { useAssistantNavStore } from '../../store/assistantNavStore';
import { assistantBrowserOwnerId } from '../../../shared/browserOwner';

async function syncSelectedAssistantTab(assistantId: string, expectedTabId?: string): Promise<void> {
  const ui = useAssistantSurfaceStore.getState().byId[assistantId];
  const tabId = ui?.activeTabId;
  if (useAssistantNavStore.getState().activeAssistantId !== assistantId || !ui?.browserVisible || !tabId
    || (expectedTabId && tabId !== expectedTabId)) return;
  const owner = assistantBrowserOwnerId(assistantId);
  const presentation = currentBrowserPresentation(owner, owner, tabId);
  if (presentation?.ready) await window.electronAPI.browserSwitchTab(owner, tabId, presentation.lease);
}

async function createAssistantTab(assistantId: string): Promise<string | null> {
  const tabId = useAssistantSurfaceStore.getState().addTab(assistantId);
  if (!tabId) return null;
  const owner = assistantBrowserOwnerId(assistantId);
  await window.electronAPI.browserCreateTab(owner, tabId, owner);
  if (!useAssistantSurfaceStore.getState().byId[assistantId]?.tabs.some((tab) => tab.id === tabId)) return null;
  await syncSelectedAssistantTab(assistantId, tabId);
  return tabId;
}

/**
 * Assistant adapter for the shared Browser mechanics: state from the Assistant UI store, a local
 * Browser with tabs and navigation only. Annotation handoff and SSH remote preview are workspace
 * semantics and stay off.
 */
export default function AssistantBrowserPanel({ assistantId, isActive, layoutVersion }: { assistantId: string; isActive: boolean; layoutVersion: number }) {
  const ui = useAssistantSurfaceStore((state) => state.byId[assistantId]);
  const store = useAssistantSurfaceStore;
  const ownerId = assistantBrowserOwnerId(assistantId);
  const model = useMemo<BrowserPanelModel>(() => ({
    ownerId,
    paneId: ownerId,
    visible: ui?.browserVisible ?? false,
    isActiveOwner: isActive,
    tabs: ui?.tabs ?? [],
    activeTabId: ui?.activeTabId ?? null,
    browserUrl: ui?.browserUrl ?? '',
    overlayCount: ui?.browserOverlayCount ?? 0,
    updateTab: (tabId, partial) => { store.getState().updateTab(assistantId, tabId, partial); },
    removeTab: (tabId) => store.getState().removeTab(assistantId, tabId),
    setActiveTab: (tabId) => store.getState().setActiveTab(assistantId, tabId),
    moveTab: (tabId, targetTabId) => store.getState().moveTab(assistantId, tabId, targetTabId),
    pushOverlay: () => store.getState().pushOverlay(assistantId),
    popOverlay: () => store.getState().popOverlay(assistantId),
    createTab: () => createAssistantTab(assistantId),
    syncSelectedTab: () => syncSelectedAssistantTab(assistantId),
    features: { annotation: false, paneDrag: false },
  }), [assistantId, ownerId, ui, isActive, store]);
  return <BrowserPanelCore model={model} layoutVersion={layoutVersion} />;
}
