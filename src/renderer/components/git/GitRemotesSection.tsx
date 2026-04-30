/**
 * GitRemotesSection Component
 * UI for managing git remotes (add, remove, rename).
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { Plus, Trash2, Edit2, X, Loader2, Check, AlertCircle, Globe, Network } from 'lucide-react';
import type { VcsProvider } from '../../../shared/types/vcs';
import './GitRemotesSection.css';

export interface GitRemoteEntry {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

interface GitRemotesSectionProps {
  workspacePath: string;
  remotes: GitRemoteEntry[];
  provider: VcsProvider;
  onRemotesChanged: () => void;
  onError: (error: string | null) => void;
}

type RemoteMode = 'list' | 'add' | 'edit';

interface RemoteFormState {
  name: string;
  url: string;
  isSubmitting: boolean;
  error: string | null;
}

interface RemoteNameInputProps {
  id: string;
  value: string;
  placeholder: string;
  disabled: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  showError: boolean;
  showSuccess: boolean;
  onChange: (value: string) => void;
  onEnter: () => void;
  onEscape: () => void;
}

const REMOTE_NAME_SUGGESTIONS = ['origin', 'upstream', 'github', 'gitlab', 'bitbucket'];

function RemoteNameInput({ id, value, placeholder, disabled, inputRef, showError, showSuccess, onChange, onEnter, onEscape }: RemoteNameInputProps) {
  return (
    <div className="git-remotes-input-row">
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="git-remotes-input"
        disabled={disabled}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onEnter();
          } else if (e.key === 'Escape') {
            onEscape();
          }
        }}
      />
      {showError ? (
        <AlertCircle size={14} className="git-remotes-input-icon git-remotes-input-icon-error" />
      ) : showSuccess ? (
        <Check size={14} className="git-remotes-input-icon git-remotes-input-icon-success" />
      ) : null}
    </div>
  );
}

function RemoteFormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="git-remotes-form-error">
      <AlertCircle size={12} />
      <span>{message}</span>
    </div>
  );
}

function RemoteList({
  remotes,
  onAdd,
  onEdit,
  onRemove,
}: {
  remotes: GitRemoteEntry[];
  onAdd: () => void;
  onEdit: (remote: GitRemoteEntry) => void;
  onRemove: (name: string) => void;
}) {
  return (
    <div className="git-remotes-list">
      {remotes.length === 0 ? (
        <div className="git-remotes-empty">
          <Network size={24} strokeWidth={1.5} />
          <p>No remotes configured</p>
          <span className="git-remotes-hint">Add a remote to connect to a repository host</span>
          <button type="button" className="git-remotes-empty-add-btn" onClick={onAdd}>
            <Plus size={12} />
            Add remote
          </button>
        </div>
      ) : (
        remotes.map((remote) => (
          <div key={remote.name} className="git-remote-item">
            <div className="git-remote-info">
              <span className="git-remote-name">{remote.name}</span>
              <span className="git-remote-url" title={remote.fetchUrl}>
                {remote.fetchUrl}
              </span>
            </div>
            <div className="git-remote-actions">
              <button type="button" className="git-remote-action-btn" onClick={() => onEdit(remote)} title="Rename remote">
                <Edit2 size={12} />
              </button>
              <button
                type="button"
                className="git-remote-action-btn git-remote-action-btn-danger"
                onClick={() => onRemove(remote.name)}
                title="Remove remote"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export default function GitRemotesSection({
  workspacePath,
  remotes,
  provider,
  onRemotesChanged,
  onError,
}: GitRemotesSectionProps) {
  const [mode, setMode] = useState<RemoteMode>('list');
  const [editingRemote, setEditingRemote] = useState<string | null>(null);
  const [form, setForm] = useState<RemoteFormState>({
    name: '',
    url: '',
    isSubmitting: false,
    error: null,
  });
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Focus input when switching to add/edit mode
  useEffect(() => {
    if (mode === 'add' || mode === 'edit') {
      setTimeout(() => nameInputRef.current?.focus(), 50);
    }
  }, [mode]);

  // Reset form when closing
  const resetForm = useCallback(() => {
    setForm({ name: '', url: '', isSubmitting: false, error: null });
    setEditingRemote(null);
    setMode('list');
  }, []);

  // Handle adding a new remote
  const handleAddRemote = useCallback(async () => {
    if (!form.name.trim() || !form.url.trim()) {
      setForm((prev) => ({ ...prev, error: 'Name and URL are required' }));
      return;
    }

    setForm((prev) => ({ ...prev, isSubmitting: true, error: null }));

    try {
      const result = await window.electronAPI.gitAddRemote(
        workspacePath,
        form.name.trim(),
        form.url.trim()
      );

      if (result.success) {
        resetForm();
        onRemotesChanged();
        onError(null);
      } else {
        setForm((prev) => ({
          ...prev,
          isSubmitting: false,
          error: result.error || 'Failed to add remote',
        }));
      }
    } catch (err) {
      setForm((prev) => ({
        ...prev,
        isSubmitting: false,
        error: err instanceof Error ? err.message : 'Failed to add remote',
      }));
    }
  }, [form.name, form.url, workspacePath, resetForm, onRemotesChanged, onError]);

  // Handle removing a remote
  const handleRemoveRemote = useCallback(
    async (name: string) => {
      if (!confirm(`Are you sure you want to remove the remote '${name}'?`)) {
        return;
      }

      try {
        const result = await window.electronAPI.gitRemoveRemote(workspacePath, name);

        if (result.success) {
          onRemotesChanged();
          onError(null);
        } else {
          onError(result.error || 'Failed to remove remote');
        }
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Failed to remove remote');
      }
    },
    [workspacePath, onRemotesChanged, onError]
  );

  // Handle renaming a remote
  const handleRenameRemote = useCallback(async () => {
    if (!editingRemote || !form.name.trim()) {
      setForm((prev) => ({ ...prev, error: 'Name is required' }));
      return;
    }

    if (editingRemote === form.name.trim()) {
      resetForm();
      return;
    }

    setForm((prev) => ({ ...prev, isSubmitting: true, error: null }));

    try {
      const result = await window.electronAPI.gitRenameRemote(
        workspacePath,
        editingRemote,
        form.name.trim()
      );

      if (result.success) {
        resetForm();
        onRemotesChanged();
        onError(null);
      } else {
        setForm((prev) => ({
          ...prev,
          isSubmitting: false,
          error: result.error || 'Failed to rename remote',
        }));
      }
    } catch (err) {
      setForm((prev) => ({
        ...prev,
        isSubmitting: false,
        error: err instanceof Error ? err.message : 'Failed to rename remote',
      }));
    }
  }, [editingRemote, form.name, workspacePath, resetForm, onRemotesChanged, onError]);

  // Start editing a remote
  const startEditing = useCallback(
    (remote: GitRemoteEntry) => {
      setEditingRemote(remote.name);
      setForm({
        name: remote.name,
        url: remote.fetchUrl,
        isSubmitting: false,
        error: null,
      });
      setMode('edit');
    },
    []
  );

  // Handle form input changes
  const handleNameChange = useCallback((value: string) => {
    setForm((prev) => ({ ...prev, name: value.toLowerCase(), error: null }));
  }, []);

  const handleUrlChange = useCallback((value: string) => {
    setForm((prev) => ({ ...prev, url: value, error: null }));
  }, []);

  // Get provider name for display
  // Check if remote already exists
  const remoteExists = useCallback(
    (name: string) => {
      const normalizedName = name.toLowerCase().trim();
      return remotes.some((r) => r.name.toLowerCase() === normalizedName && r.name !== editingRemote);
    },
    [remotes, editingRemote]
  );

  // Validate form
  const validationError = form.name.trim()
    ? remoteExists(form.name)
      ? 'A remote with this name already exists'
      : !/^[a-z0-9._-]+$/.test(form.name)
        ? 'Use lowercase letters, numbers, hyphens, underscores, or dots'
        : null
    : null;

  const canSubmitAdd = !form.isSubmitting && !validationError && !!form.name.trim() && !!form.url.trim();
  const canSubmitRename = !form.isSubmitting && !validationError && !!form.name.trim() && form.name !== editingRemote;
  const submitAddOnEnter = () => {
    if (canSubmitAdd) {
      void handleAddRemote();
    }
  };
  const submitRenameOnEnter = () => {
    if (canSubmitRename) {
      void handleRenameRemote();
    }
  };
  const formErrorMessage = form.error || validationError;

  return (
    <div className="git-remotes-section">
      <div className="git-remotes-header">
        <div className="git-remotes-title">
          <Globe size={14} />
          <span>Remotes</span>
          <span className="git-remotes-count">{remotes.length}</span>
        </div>
        {mode === 'list' && (
          <button
            type="button"
            className="git-remotes-add-btn"
            onClick={() => setMode('add')}
            title="Add remote"
          >
            <Plus size={14} />
          </button>
        )}
        {mode !== 'list' && (
          <button
            type="button"
            className="git-remotes-cancel-btn"
            onClick={resetForm}
            title="Cancel"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {mode === 'list' && (
        <RemoteList
          remotes={remotes}
          onAdd={() => setMode('add')}
          onEdit={startEditing}
          onRemove={(name) => void handleRemoveRemote(name)}
        />
      )}

      {mode === 'add' && (
        <div className="git-remotes-form">
          <div className="git-remotes-form-field">
            <label htmlFor="remote-name">Name</label>
            <RemoteNameInput
              id="remote-name"
              value={form.name}
              placeholder="origin"
              disabled={form.isSubmitting}
              inputRef={nameInputRef}
              showError={!!validationError}
              showSuccess={!!form.name.trim() && !remoteExists(form.name)}
              onChange={handleNameChange}
              onEnter={submitAddOnEnter}
              onEscape={resetForm}
            />
            <div className="git-remotes-suggestions">
              {REMOTE_NAME_SUGGESTIONS.filter(
                (s) => s.includes(form.name) || form.name.length === 0
              )
                .filter((s) => !remoteExists(s))
                .slice(0, 3)
                .map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="git-remotes-suggestion"
                    onClick={() => handleNameChange(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
            </div>
          </div>

          <div className="git-remotes-form-field">
            <label htmlFor="remote-url">URL</label>
            <div className="git-remotes-input-row">
              <input
                id="remote-url"
                type="text"
                value={form.url}
                onChange={(e) => handleUrlChange(e.target.value)}
                placeholder={
                  provider !== 'unknown'
                    ? `git@${provider}.com:user/repo.git or https://${provider}.com/user/repo.git`
                    : 'git@host:user/repo.git or https://host/user/repo.git'
                }
                className="git-remotes-input"
                disabled={form.isSubmitting}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (!validationError && !form.isSubmitting) {
                      void handleAddRemote();
                    }
                  } else if (e.key === 'Escape') {
                    resetForm();
                  }
                }}
              />
            </div>
          </div>

          <RemoteFormError message={formErrorMessage} />

          <button
            type="button"
            className="git-remotes-submit-btn"
            onClick={handleAddRemote}
            disabled={!canSubmitAdd}
          >
            {form.isSubmitting ? (
              <>
                <Loader2 size={14} className="spin" />
                Adding...
              </>
            ) : (
              <>
                <Plus size={14} />
                Add Remote
              </>
            )}
          </button>
        </div>
      )}

      {mode === 'edit' && (
        <div className="git-remotes-form">
          <div className="git-remotes-form-info">
            <span>Rename: </span>
            <strong>{editingRemote}</strong>
          </div>

          <div className="git-remotes-form-field">
            <label htmlFor="remote-new-name">New Name</label>
            <RemoteNameInput
              id="remote-new-name"
              value={form.name}
              placeholder="new-name"
              disabled={form.isSubmitting}
              inputRef={nameInputRef}
              showError={!!validationError}
              showSuccess={!!form.name.trim() && form.name !== editingRemote && !remoteExists(form.name)}
              onChange={handleNameChange}
              onEnter={submitRenameOnEnter}
              onEscape={resetForm}
            />
          </div>

          <RemoteFormError message={formErrorMessage} />

          <button
            type="button"
            className="git-remotes-submit-btn"
            onClick={handleRenameRemote}
            disabled={!canSubmitRename}
          >
            {form.isSubmitting ? (
              <>
                <Loader2 size={14} className="spin" />
                Renaming...
              </>
            ) : (
              <>
                <Check size={14} />
                Rename Remote
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
