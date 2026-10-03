/**
 * App-level Assistant navigation. An Assistant is NOT a workspace: this store holds only which
 * Assistant surface (if any) is on screen and which have been opened (and so are kept alive).
 * It never touches workspace paths, terminals, checkout contexts, Git or Explorer state.
 */
import { create } from 'zustand';

export interface AssistantNavState {
  activeBotId: string | null;
  /** Opened surfaces stay mounted (parked) so switching away never ends an in-flight turn. */
  openedBotIds: string[];
  openBot: (botId: string) => void;
  clearActive: () => void;
}

export const useAssistantNavStore = create<AssistantNavState>((set) => ({
  activeBotId: null,
  openedBotIds: [],
  openBot: (botId) => set((state) => ({
    activeBotId: botId,
    openedBotIds: state.openedBotIds.includes(botId) ? state.openedBotIds : [...state.openedBotIds, botId],
  })),
  clearActive: () => set((state) => (state.activeBotId === null ? state : { activeBotId: null })),
}));
