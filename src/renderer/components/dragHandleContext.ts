import { createContext, useContext } from 'react';

export const DragHandleContext = createContext<Record<string, unknown> | null>(null);

export function useDragHandle() {
  return useContext(DragHandleContext);
}
