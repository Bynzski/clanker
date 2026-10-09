import { useLayoutEffect } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useAssistantSurfaceStore } from '../store/assistantSurfaceStore';
import { workspaceBrowserPresented } from '../store/workspacePages';
import { assistantBrowserOwnerId } from '../../shared/browserOwner';
import { browserResourceExists, currentBrowserPresentation, ensureBrowserResource, markBrowserPresentationReady, setBrowserPresentation } from '../lib/browserPresentation';

interface BrowserLifecycleCoordinatorProps { activeOwnerId: string | null }

/** The only renderer authority for native Browser presentation, across all destinations. */
export default function BrowserLifecycleCoordinator({ activeOwnerId }: BrowserLifecycleCoordinatorProps) {
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const assistants = useAssistantSurfaceStore((state) => state.byId);
  const workspace = workspaces.find((entry) => entry.id === activeOwnerId);
  const assistant = Object.entries(assistants).find(([id]) => assistantBrowserOwnerId(id) === activeOwnerId)?.[1];
  const paneId = workspace?.browserPane?.id ?? (assistant ? activeOwnerId : null);
  const tabId = workspace?.browserPane?.activeTabId ?? assistant?.activeTabId;
  const tabs = workspace?.browserPane?.tabs ?? assistant?.tabs;
  const visible = workspace ? workspaceBrowserPresented(workspace) && !workspace.browserOverlayCount
    : assistant?.browserVisible && !assistant.browserOverlayCount;
  const url = tabs?.find((tab) => tab.id === tabId)?.url ?? 'https://github.com';
  useLayoutEffect(() => {
    // Legacy embeddings may have unscoped resources and no canonical page state.
    // Native ignores these calls for owners which have opted into leases.
    for (const owner of workspaces) {
      if (!owner.pages && owner.id !== activeOwnerId && (owner.browserVisible || owner.browserPane)) void window.electronAPI.browserHide(owner.id);
    }
    const presentation = setBrowserPresentation(visible ? activeOwnerId : null, paneId ?? undefined, tabId ?? undefined);
    if (!presentation || presentation.ready) return;
    let cancelled = false;
    const valid = () => !cancelled && currentBrowserPresentation(presentation.ownerId) === presentation;
    // Main enforces the last-tab rule per pane. Materialize the whole owning
    // collection before presentation, including a preview's unselected default tab.
    void Promise.all((tabs ?? []).map((tab) => ensureBrowserResource(presentation.ownerId, presentation.lease.paneId, tab.id, tab.url,
      () => valid() && browserResourceExists(presentation.ownerId, presentation.lease.paneId, tab.id)))).then(async () => {
      if (cancelled || currentBrowserPresentation(presentation.ownerId) !== presentation) return;
      if (await window.electronAPI.browserActivate(presentation.ownerId, presentation.tabId, presentation.lease)) {
        if (!cancelled) markBrowserPresentationReady(presentation);
      }
    }).catch(() => { /* A closed owner or retired tab cannot claim visibility. */ });
    return () => { cancelled = true; };
  }, [activeOwnerId, paneId, tabId, visible, url, workspaces, tabs]);
  useLayoutEffect(() => () => { setBrowserPresentation(null); }, []);
  return null;
}
