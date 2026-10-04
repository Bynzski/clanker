/**
 * Renderer-only UI state for Assistant surfaces: the Browser sidecar's tabs/visibility and split ratio.
 * Deliberately separate from Hermes service state (main's snapshot) and from workspace state: it has no
 * paths, Git, terminals, checkout contexts, Files or editor state.
 */
import { create } from 'zustand';
import type { BrowserTab } from './workspaceTypes';
import { createDefaultBrowserTab } from './workspaceStoreHelpers';

export interface AssistantSurfaceUiState {
  browserVisible: boolean;
  tabs: BrowserTab[];
  activeTabId: string | null;
  browserUrl: string;
  browserOverlayCount: number;
  /** Primary-pane share of the split (percent), in memory only. */
  sidecarRatio: number;
}

export const DEFAULT_SIDECAR_PRIMARY_RATIO = 65;

const initial = (): AssistantSurfaceUiState => ({
  browserVisible: false, tabs: [], activeTabId: null, browserUrl: '', browserOverlayCount: 0, sidecarRatio: DEFAULT_SIDECAR_PRIMARY_RATIO,
});

interface AssistantSurfaceStoreState {
  byId: Record<string, AssistantSurfaceUiState>;
  setBrowserVisible: (assistantId: string, visible: boolean) => void;
  toggleBrowser: (assistantId: string) => void;
  addTab: (assistantId: string) => string | null;
  removeTab: (assistantId: string, tabId: string) => { removed: boolean; nextActiveTabId: string | null };
  setActiveTab: (assistantId: string, tabId: string) => boolean;
  moveTab: (assistantId: string, tabId: string, targetTabId: string) => void;
  updateTab: (assistantId: string, tabId: string, partial: Partial<Pick<BrowserTab, 'url' | 'title' | 'canGoBack' | 'canGoForward'>>) => boolean;
  pushOverlay: (assistantId: string) => void;
  popOverlay: (assistantId: string) => void;
  setRatio: (assistantId: string, ratio: number) => void;
  /** Deliberate teardown of every Assistant surface's UI state. */
  clearAll: () => void;
}

function patch(state: AssistantSurfaceStoreState, id: string, fn: (current: AssistantSurfaceUiState) => AssistantSurfaceUiState) {
  const current = state.byId[id] ?? initial();
  return { byId: { ...state.byId, [id]: fn(current) } };
}

export const useAssistantSurfaceStore = create<AssistantSurfaceStoreState>((set, get) => ({
  byId: {},
  setBrowserVisible: (id, visible) => set((state) => patch(state, id, (current) => {
    if (visible && current.tabs.length === 0) {
      const tab = createDefaultBrowserTab();
      return { ...current, browserVisible: true, tabs: [tab], activeTabId: tab.id, browserUrl: tab.url };
    }
    return { ...current, browserVisible: visible };
  })),
  toggleBrowser: (id) => get().setBrowserVisible(id, !(get().byId[id]?.browserVisible ?? false)),
  addTab: (id) => {
    const tab = createDefaultBrowserTab();
    set((state) => patch(state, id, (current) => ({ ...current, tabs: [...current.tabs, tab], activeTabId: tab.id, browserUrl: tab.url })));
    return tab.id;
  },
  removeTab: (id, tabId) => {
    const current = get().byId[id];
    if (!current) return { removed: false, nextActiveTabId: null };
    const index = current.tabs.findIndex((tab) => tab.id === tabId);
    if (index === -1 || current.tabs.length <= 1) return { removed: false, nextActiveTabId: current.activeTabId };
    const tabs = current.tabs.filter((tab) => tab.id !== tabId);
    const nextActiveTabId = current.activeTabId === tabId ? (current.tabs[index + 1] ?? current.tabs[index - 1])?.id ?? null : current.activeTabId;
    const nextTab = tabs.find((tab) => tab.id === nextActiveTabId);
    set((state) => patch(state, id, (c) => ({ ...c, tabs, activeTabId: nextActiveTabId, browserUrl: nextTab?.url ?? c.browserUrl })));
    return { removed: true, nextActiveTabId };
  },
  setActiveTab: (id, tabId) => {
    const target = get().byId[id]?.tabs.find((tab) => tab.id === tabId);
    if (!target) return false;
    set((state) => patch(state, id, (current) => ({ ...current, activeTabId: tabId, browserUrl: target.url })));
    return true;
  },
  moveTab: (id, tabId, targetTabId) => set((state) => patch(state, id, (current) => {
    const from = current.tabs.findIndex((tab) => tab.id === tabId);
    const to = current.tabs.findIndex((tab) => tab.id === targetTabId);
    if (from < 0 || to < 0 || from === to) return current;
    const tabs = [...current.tabs];
    const [moved] = tabs.splice(from, 1);
    tabs.splice(to, 0, moved);
    return { ...current, tabs };
  })),
  updateTab: (id, tabId, partial) => {
    if (!get().byId[id]?.tabs.some((tab) => tab.id === tabId)) return false;
    set((state) => patch(state, id, (current) => ({
      ...current,
      tabs: current.tabs.map((tab) => (tab.id === tabId ? {
        ...tab,
        ...(typeof partial.url === 'string' ? { url: partial.url } : {}),
        ...(typeof partial.title === 'string' ? { title: partial.title } : {}),
        ...(typeof partial.canGoBack === 'boolean' ? { canGoBack: partial.canGoBack } : {}),
        ...(typeof partial.canGoForward === 'boolean' ? { canGoForward: partial.canGoForward } : {}),
      } : tab)),
      browserUrl: current.activeTabId === tabId && typeof partial.url === 'string' ? partial.url : current.browserUrl,
    })));
    return true;
  },
  pushOverlay: (id) => set((state) => patch(state, id, (current) => ({ ...current, browserOverlayCount: current.browserOverlayCount + 1 }))),
  popOverlay: (id) => set((state) => patch(state, id, (current) => ({ ...current, browserOverlayCount: Math.max(0, current.browserOverlayCount - 1) }))),
  setRatio: (id, ratio) => set((state) => patch(state, id, (current) => (Number.isFinite(ratio) && ratio >= 10 && ratio <= 90 ? { ...current, sidecarRatio: ratio } : current))),
  clearAll: () => set((state) => (Object.keys(state.byId).length === 0 ? state : { byId: {} })),
}));
