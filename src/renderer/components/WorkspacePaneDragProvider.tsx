import { createContext, useContext, type ReactNode } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { selectFocusedWorkspace, useWorkspaceStore } from '../store/workspaceStore';
import { paneCollisionDetection, currentPaneDrag } from '../lib/workspacePaneDrag';

const SharedPaneDrag = createContext(false);
export function useSharedPaneDrag(): boolean { return useContext(SharedPaneDrag); }

/** A single drag domain covers workspace panes and the status bar, without wrapping DOM/chrome. */
export default function WorkspacePaneDragProvider({ children }: { children: ReactNode }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));
  const cancelDrop = (event: DragEndEvent) => {
    const workspace = selectFocusedWorkspace(useWorkspaceStore.getState());
    return !workspace || !currentPaneDrag(event.active.data.current, workspace);
  };
  return <SharedPaneDrag.Provider value={true}><DndContext sensors={sensors} collisionDetection={paneCollisionDetection} cancelDrop={cancelDrop}>
    {children}
  </DndContext></SharedPaneDrag.Provider>;
}
