import { useEffect, useRef, useState } from 'react';
import type { AssistantSnapshot } from '../../shared/types/assistants';

/**
 * Snapshot reads are probe-free. Native discovery follows explicit user actions, plus one hydration
 * request per mount when Assistants is already enabled but this process has not checked profiles yet
 * (main coalesces concurrent requests and skips the probe once checked).
 */
export function useAssistantsSnapshot() {
  const [snapshot, setSnapshot] = useState<AssistantSnapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [hydrationFailed, setHydrationFailed] = useState(false);
  const hydrationRequested = useRef(false);
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

  const needsHydration = snapshot?.settings.enabled === true && snapshot.profilesChecked === false;
  useEffect(() => {
    if (!needsHydration || hydrationRequested.current) return;
    hydrationRequested.current = true;
    void run(async () => {
      try {
        const value = await window.electronAPI.discoverAssistants({ ifUnchecked: true });
        if (value.profilesChecked === false) setHydrationFailed(true);
        return value;
      }
      catch (err) { setHydrationFailed(true); throw err; }
    });
  }, [needsHydration]);

  /** True only while this process has genuinely not checked native profiles (never for a checked failure). */
  const unchecked = needsHydration && snapshot?.profilesChecked === false;
  return { snapshot, error, busy, setError, setBusy, run, unchecked, hydrationFailed };
}
