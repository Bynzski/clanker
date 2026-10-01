import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ArrowLeft, Folder, FolderPlus, Loader2, X } from 'lucide-react';
import type { RemoteDirectoryListing } from '../../shared/types/environments';
import { Dialog, DialogContent, DialogTitle, DialogClose } from './ui/Dialog';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { Input } from './ui/Input';
import './RemoteDirectoryChooser.css';
interface Props {
  environmentId: string;
  initialPath: string;
  homePath: string;
  triggerRef?: React.RefObject<HTMLElement | null>;
  onSelect: (path: string) => void;
  onClose: () => void;
}

export default function RemoteDirectoryChooser({ environmentId, initialPath, homePath, triggerRef, onSelect, onClose }: Props) {
  const [listing, setListing] = useState<RemoteDirectoryListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestRef = useRef(0);
  const createRequestRef = useRef(0);
  const creatingRef = useRef(false);
  const previousLocationRef = useRef({ environmentId, initialPath });
  const [requestedPath, setRequestedPath] = useState(initialPath);
  const [attempt, setAttempt] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isCreating) {
      newFolderInputRef.current?.focus();
    }
  }, [isCreating]);


  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    const trigger = triggerRef?.current;
    return () => {
      trigger?.focus();
    };
  }, [triggerRef]);
  useEffect(() => {
    const previous = previousLocationRef.current;
    if (previous.environmentId === environmentId && previous.initialPath === initialPath) return;
    previousLocationRef.current = { environmentId, initialPath };
    requestRef.current++;
    createRequestRef.current++;
    creatingRef.current = false;
    setCreating(false);
    setIsCreating(false);
    setListing(null);
    setError('');
    setLoading(true);
    setRequestedPath(initialPath);
    setAttempt((previous) => previous + 1);
  }, [environmentId, initialPath]);

  useEffect(() => {
    const request = ++requestRef.current;
    let active = true;
    void window.electronAPI.sshListDirectories(environmentId, requestedPath).then((result) => {
      if (!active || request !== requestRef.current) return;
      setListing(result);
      setLoading(false);
    }).catch((reason: unknown) => {
      if (!active || request !== requestRef.current) return;
      setError(reason instanceof Error ? reason.message : String(reason));
      setLoading(false);
    });
    return () => { active = false; };
  }, [environmentId, requestedPath, attempt]);

  const navigate = (path: string) => {
    requestRef.current++;
    createRequestRef.current++;
    creatingRef.current = false;
    setCreating(false);
    setListing(null);
    setLoading(true);
    setError('');
    setRequestedPath(path);
    setIsCreating(false);
    setNewFolderName('');
    setCreateError('');
    setAttempt((previous) => previous + 1);
    dialogRef.current?.focus();
  };

  const handleCreateFolder = async () => {
    if (creatingRef.current) return;
    const trimmed = newFolderName.trim();
    if (!trimmed) {
      setCreateError('Folder name is required');
      return;
    }
    if (trimmed.includes('/') || trimmed.includes('\\') || trimmed === '.' || trimmed === '..') {
      setCreateError('Folder name cannot contain slashes or relative segments');
      return;
    }
    if (!listing) return;
    const request = ++createRequestRef.current;
    creatingRef.current = true;
    setCreating(true);
    setCreateError('');
    try {
      const result = await window.electronAPI.sshCreateDirectory(environmentId, listing.path, trimmed);
      if (request !== createRequestRef.current) return;
      setIsCreating(false);
      setNewFolderName('');
      navigate(result.path);
    } catch (err) {
      if (request === createRequestRef.current) setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      if (request === createRequestRef.current) {
        creatingRef.current = false;
        setCreating(false);
      }
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (
      (event.key === 'Backspace' || event.key === 'ArrowLeft') &&
      !creating &&
      listing?.parentPath &&
      !(event.target instanceof HTMLInputElement)
    ) {
      event.preventDefault();
      navigate(listing.parentPath);
    }
    if (event.key === 'Enter' && event.target === event.currentTarget && listing && !loading) {
      event.preventDefault();
      onSelect(listing.path);
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const items = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('.remote-chooser-list > button') ?? []);
      if (!items.length) return;
      event.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        index < 0
          ? event.key === 'ArrowDown'
            ? 0
            : items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      items[next]?.focus();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        ref={dialogRef}
        tabIndex={-1}
        className="remote-chooser"
        overlayClassName="remote-chooser-overlay"
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          dialogRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (triggerRef?.current?.isConnected) {
            event.preventDefault();
            triggerRef.current.focus();
          }
        }}
        onKeyDown={handleKeyDown}
      >
        <div className="remote-chooser-header">
          <DialogTitle asChild>
            <strong>Browse remote directories</strong>
          </DialogTitle>
          <DialogClose asChild>
            <IconButton aria-label="Close remote browser"><X size={16} /></IconButton>
          </DialogClose>
        </div>
        <div className="remote-chooser-toolbar">
          <Button
            size="sm"
            variant="secondary"
            aria-label="Parent directory"
            disabled={loading || creating || !listing?.parentPath}
            onClick={() => {
              if (listing?.parentPath) navigate(listing.parentPath);
            }}
          >
            <ArrowLeft size={14} /> Parent
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => navigate(homePath)}
            disabled={loading || creating || !homePath}
          >
            Home
          </Button>
          <Button
            size="sm"
            variant="secondary"
            aria-label="New folder"
            disabled={loading || creating || !listing}
            onClick={() => {
              setIsCreating(true);
              setNewFolderName('');
              setCreateError('');
            }}
          >
            <FolderPlus size={14} /> New Folder
          </Button>
          <span title={listing?.path ?? requestedPath}>{listing?.path ?? requestedPath}</span>
        </div>
        {isCreating && (
          <form
            className="remote-chooser-new-folder"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreateFolder();
            }}
          >
            <FolderPlus size={15} />
            <Input
              ref={newFolderInputRef}
              size="sm"
              className="remote-chooser-input"
              aria-label="New folder name"
              placeholder="Folder name"
              value={newFolderName}
              onChange={(event) => {
                setNewFolderName(event.target.value);
                setCreateError('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  setIsCreating(false);
                  setCreateError('');
                }
              }}
              disabled={creating}
              autoFocus
            />
            <Button size="sm" variant="primary" type="submit" disabled={creating || !newFolderName.trim()}>
              {creating ? <Loader2 className="spin" size={13} /> : 'Create'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              type="button"
              onClick={() => {
                setIsCreating(false);
                setCreateError('');
              }}
              disabled={creating}
            >
              Cancel
            </Button>
            {createError && <span className="remote-chooser-inline-error" role="alert">{createError}</span>}
          </form>
        )}
        <div className="remote-chooser-list">
          {loading && <p role="status"><Loader2 className="spin" size={15} /> Loading directories…</p>}
          {error && <p role="alert">{error} <button type="button" onClick={() => navigate(requestedPath)}>Retry</button></p>}
          {!loading && !error && listing?.directories.length === 0 && <p>No subdirectories</p>}
          {!loading && !error && listing?.directories.map((directory) => (
            <button type="button" key={directory.path} disabled={creating} onClick={() => navigate(directory.path)}>
              <Folder size={15} /> {directory.name}
            </button>
          ))}
        </div>
        <div className="remote-chooser-actions">
          <DialogClose asChild>
            <Button size="sm" variant="secondary" type="button">
              Cancel
            </Button>
          </DialogClose>
          <Button
            size="sm"
            variant="primary"
            type="button"
            disabled={!listing || loading || creating}
            onClick={() => {
              if (listing) onSelect(listing.path);
            }}
          >
            Select this directory
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
