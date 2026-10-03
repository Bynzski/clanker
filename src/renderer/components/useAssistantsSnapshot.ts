import { useEffect, useRef, useState } from 'react';
import type { AssistantSnapshot } from '../../shared/types/assistants';

/** Snapshot reads are probe-free; native discovery only follows explicit user actions. */
export function useAssistantsSnapshot() {
  const [snapshot, setSnapshot] = useState<AssistantSnapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef({ request: 0, event: 0, live: false });

  const run = async (operation: () => Promise<AssistantSnapshot>) => {
    const state = generation.current;
    const request = ++state.request;
    const event = state.event;
    setBusy(true);
    setError('');
    try {
      const value = await operation();
      if (state.live && request === state.request && event === state.event) setSnapshot(value);
    } catch (err) {
      if (state.live && request === state.request) setError(String(err));
    } finally {
      if (state.live && request === state.request) setBusy(false);
    }
  };
  useEffect(() => {
    const state = generation.current;
    state.live = true;
    const event = state.event;
    void window.electronAPI.getAssistants().then((value) => {
      if (state.live && event === state.event) setSnapshot(value);
    }).catch((err: unknown) => { if (state.live && event === state.event) setError(String(err)); });
    const unsubscribe = window.electronAPI.onAssistantsChanged((value) => {
      if (state.live) { state.event++; setSnapshot(value); }
    });
    return () => { state.live = false; state.request++; state.event++; unsubscribe(); };
  }, []);

  return { snapshot, error, busy, setError, setBusy, run };
}
