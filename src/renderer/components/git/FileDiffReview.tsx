import DiffViewer from '../DiffViewer';
import type { DiffViewerState } from './diffTypes';

export function FileDiffReview({ state, workspaceId, onClose }: {
  state: DiffViewerState; workspaceId?: string; onClose: () => void;
}) {
  return state.isOpen ? <DiffViewer {...state} workspaceId={workspaceId} onClose={onClose} /> : null;
}
