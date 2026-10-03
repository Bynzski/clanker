import { useEffect, useRef, useState } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';

/** Inline workspace rename state shared by every workspace navigation surface. */
export function useWorkspaceRename() {
  const updateWorkspaceName = useWorkspaceStore((state) => state.updateWorkspaceName);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const startEditing = (id: string, currentName: string) => {
    setEditingId(id);
    setEditValue(currentName);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditValue('');
  };
  const saveEdit = () => {
    if (editingId && editValue.trim()) {
      updateWorkspaceName(editingId, editValue.trim());
    }
    cancelEdit();
  };
  const handleEditKeyDown = (event: { key: string }) => {
    if (event.key === 'Enter') saveEdit();
    else if (event.key === 'Escape') cancelEdit();
  };

  return { editingId, editValue, setEditValue, inputRef, startEditing, saveEdit, cancelEdit, handleEditKeyDown };
}
