import { useCallback, useEffect, useRef, useState } from 'react';
import { initialDiffViewerState } from './diffTypes';
import type { DiffViewerState } from './diffTypes';

/** One request lifecycle for Changes and Commit; no status polling or mutation ownership. */
export function useFileDiffReview(workspacePath: string, workspaceId: string | undefined,
  enabled: boolean, revision: string, isScopeCurrent?: () => boolean) {
  const [diffState, setDiffState] = useState<DiffViewerState>(initialDiffViewerState);
  const generation = useRef(0);
  const identity = `${workspaceId ?? ''}\0${workspacePath}\0${enabled}\0${revision}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const closeDiff = useCallback(() => {
    generation.current++;
    setDiffState(initialDiffViewerState);
  }, []);
  useEffect(() => {
    closeDiff();
    const requests = generation;
    return () => { requests.current++; };
  }, [identity, closeDiff]);
  const viewDiff = useCallback(async (filePath: string, mode: 'working' | 'staged') => {
    if (!enabled || !workspacePath || isScopeCurrent?.() === false) return;
    const request = ++generation.current;
    const fresh = () => generation.current === request && identityRef.current === identity && isScopeCurrent?.() !== false;
    setDiffState({ ...initialDiffViewerState, isOpen: true, filePath, isLoading: true });
    try {
      const result = await window.electronAPI.gitGetFileDiff(workspacePath, filePath, mode, workspaceId);
      if (!fresh()) return;
      setDiffState(result.success
        ? { ...initialDiffViewerState, ...result, isOpen: true, filePath, isLoading: false, error: null }
        : { ...initialDiffViewerState, isOpen: true, filePath, error: result.error || 'Failed to load diff' });
    } catch (error) {
      if (fresh()) setDiffState({ ...initialDiffViewerState, isOpen: true, filePath,
        error: error instanceof Error ? error.message : 'Failed to load diff' });
    }
  }, [enabled, workspacePath, workspaceId, identity, isScopeCurrent]);
  return { diffState, viewDiff, closeDiff };
}
