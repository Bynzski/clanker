/**
 * Renderer mirror of main's display-safe Assistants snapshot, shared by every Assistants surface
 * (sidebar, rail, strip, Settings) so they never trigger duplicate probes. Main owns all truth.
 */
import { create } from 'zustand';
import type { AssistantSettings, AssistantSnapshot, HermesAssistant } from '../../shared/types/assistants';

interface AssistantsStoreState {
  snapshot: AssistantSnapshot | null;
  error: string;
  /** Last-known Assistant presentation, so an opened surface keeps its name while the service is offline. */
  knownAssistants: Record<string, HermesAssistant>;
  busy: boolean;
  ensureSubscribed: () => void;
  configure: (settings: AssistantSettings) => Promise<void>;
  refresh: () => Promise<void>;
  /** Test seam. */
  reset: () => void;
}

let unsubscribe: (() => void) | undefined;
let loading = false;

function remember(known: Record<string, HermesAssistant>, snapshot: AssistantSnapshot): Record<string, HermesAssistant> {
  if (snapshot.assistants.length === 0) return known;
  const next = { ...known };
  for (const assistant of snapshot.assistants) next[assistant.id] = assistant;
  return next;
}

export const useAssistantsStore = create<AssistantsStoreState>((set, get) => ({
  snapshot: null,
  error: '',
  knownAssistants: {},
  busy: false,
  ensureSubscribed: () => {
    if (unsubscribe || typeof window === 'undefined' || !window.electronAPI?.getAssistants) return;
    unsubscribe = window.electronAPI.onAssistantsChanged((snapshot) => set((state) => ({ snapshot, knownAssistants: remember(state.knownAssistants, snapshot) })));
    if (loading) return;
    loading = true;
    void window.electronAPI.getAssistants().then((snapshot) => {
      set((state) => ({ snapshot: state.snapshot ?? snapshot, knownAssistants: remember(state.knownAssistants, snapshot) }));
    }).catch((error: unknown) => set({ error: String(error) })).finally(() => { loading = false; });
  },
  configure: async (settings) => {
    set({ busy: true, error: '' });
    try {
      const snapshot = await window.electronAPI.configureAssistants(settings);
      set((state) => ({ snapshot, knownAssistants: remember(state.knownAssistants, snapshot) }));
    } catch (error) { set({ error: String(error) }); } finally { set({ busy: false }); }
  },
  refresh: async () => {
    if (get().busy) return;
    set({ busy: true, error: '' });
    try {
      const snapshot = await window.electronAPI.refreshAssistants();
      set((state) => ({ snapshot, knownAssistants: remember(state.knownAssistants, snapshot) }));
    } catch (error) { set({ error: String(error) }); } finally { set({ busy: false }); }
  },
  reset: () => {
    unsubscribe?.();
    unsubscribe = undefined;
    loading = false;
    set({ snapshot: null, error: '', knownAssistants: {}, busy: false });
  },
}));
