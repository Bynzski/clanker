import { create } from 'zustand';
import type { PromptOptions } from '../components/ui/PromptDialog';

let nextPromptId = 0;
interface PendingPrompt { id: number; options: PromptOptions; answer: (confirmed: boolean) => void }
export const useAppPromptStore = create<{ queue: PendingPrompt[] }>(() => ({ queue: [] }));

/** Bounded FIFO for imperative feature failures/choices, presented by the shared AlertDialog. */
export function requestAppPrompt(options: PromptOptions): Promise<boolean> {
  if (useAppPromptStore.getState().queue.length >= 16) return Promise.resolve(false);
  return new Promise((resolve) => {
    const prompt: PendingPrompt = { id: ++nextPromptId, options, answer: (confirmed) => {
      if (!useAppPromptStore.getState().queue.includes(prompt)) return;
      useAppPromptStore.setState(({ queue }) => ({ queue: queue.filter((entry) => entry !== prompt) }));
      resolve(confirmed);
    } };
    useAppPromptStore.setState(({ queue }) => ({ queue: [...queue, prompt] }));
  });
}

export function showAppError(description: string): void {
  void requestAppPrompt({ title: 'File operation failed', description });
}
