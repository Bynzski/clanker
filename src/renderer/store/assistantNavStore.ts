/**
 * App-level Assistant navigation. An Assistant is NOT a workspace: this store holds only which
 * Assistant surface (if any) is on screen and which have been opened (and so are kept alive).
 * It never touches workspace paths, terminals, checkout contexts, Git or Explorer state.
 */
import { create } from 'zustand';

export interface AssistantNavState {
  activeAssistantId: string | null;
  /** Opened surfaces stay mounted (parked) so switching away never ends an in-flight turn. */
  openedAssistantIds: string[];
  openAssistantSurface: (assistantId: string) => void;
  clearActive: () => void;
  /** Deliberate teardown (Assistants disabled or unavailable): no active surface, none kept warm. */
  clearAllAssistants: () => void;
}

export const useAssistantNavStore = create<AssistantNavState>((set) => ({
  activeAssistantId: null,
  openedAssistantIds: [],
  openAssistantSurface: (assistantId) => set((state) => ({
    activeAssistantId: assistantId,
    openedAssistantIds: state.openedAssistantIds.includes(assistantId) ? state.openedAssistantIds : [...state.openedAssistantIds, assistantId],
  })),
  clearActive: () => set((state) => (state.activeAssistantId === null ? state : { activeAssistantId: null })),
  clearAllAssistants: () => set((state) => (state.activeAssistantId === null && state.openedAssistantIds.length === 0 ? state : { activeAssistantId: null, openedAssistantIds: [] })),
}));
