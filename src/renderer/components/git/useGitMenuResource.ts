import { useCallback, useRef, useState } from 'react';

export type GitResourcePhase = 'not-requested' | 'loading' | 'ready' | 'error';
interface Acquisition<T> { data: T; error?: string }

/** One controller-local resource. No timer, polling, global cache or cross-resource generation. */
export function useGitMenuResource<T>(isCurrent: () => boolean) {
  const initial = { phase: 'not-requested' as GitResourcePhase, data: null as T | null, error: null as string | null };
  const [state, setState] = useState(initial);
  const latest = useRef(state);
  const generation = useRef(0);
  const publish = useCallback((value: typeof state) => { latest.current = value; setState(value); }, []);
  const invalidate = useCallback(() => {
    generation.current++;
    publish({ ...latest.current, phase: 'not-requested', error: null });
  }, [publish]);
  const load = useCallback(async (read: () => Promise<Acquisition<T>>, force = false) => {
    if (!isCurrent() || !force && latest.current.phase !== 'not-requested') return;
    const request = ++generation.current;
    const fresh = () => isCurrent() && request === generation.current;
    publish({ ...latest.current, phase: 'loading', error: null });
    try {
      const result = await read();
      if (fresh()) {
        publish({ phase: result.error ? 'error' : 'ready', data: result.data, error: result.error ?? null });
        return !result.error;
      }
    } catch (error) {
      if (fresh()) publish({ ...latest.current, phase: 'error', error: error instanceof Error ? error.message : 'Resource unavailable' });
    }
    return false;
  }, [isCurrent, publish]);
  return { ...state, load, invalidate };
}
