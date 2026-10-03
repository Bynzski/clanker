import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Home,
  Loader2,
  Pencil,
  RefreshCw,
  X,
} from 'lucide-react';
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

export interface PathCrumb {
  label: string;
  path: string;
  kind: 'root' | 'home' | 'segment';
}

/** Breadcrumb segments for a POSIX path; paths under home start from a single Home crumb. */
export function getPathCrumbs(path: string, homePath: string): PathCrumb[] {
  const underHome = Boolean(homePath) && homePath !== '/' && (path === homePath || path.startsWith(`${homePath}/`));
  const crumbs: PathCrumb[] = underHome
    ? [{ label: 'Home', path: homePath, kind: 'home' }]
    : [{ label: '/', path: '/', kind: 'root' }];
  let current = underHome ? homePath : '';
  for (const segment of (underHome ? path.slice(homePath.length) : path).split('/').filter(Boolean)) {
    current = `${current}/${segment}`;
    crumbs.push({ label: segment, path: current, kind: 'segment' });
  }
  return crumbs;
}

/** Resolves a typed location: absolute paths as-is, `~` against the remote home. */
export function resolveTypedPath(value: string, homePath: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, '') || (value.trim().startsWith('/') ? '/' : '');
  if (!trimmed) return null;
  if (trimmed === '~') return homePath || null;
  if (trimmed.startsWith('~/')) return homePath ? `${homePath.replace(/\/+$/, '')}/${trimmed.slice(2)}` : null;
  return trimmed.startsWith('/') ? trimmed : null;
}

const baseName = (path: string) => path.split('/').filter(Boolean).pop() ?? '/';

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
  const [history, setHistory] = useState<string[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const [editingPath, setEditingPath] = useState(false);
  const [pathDraft, setPathDraft] = useState('');
  const [pathError, setPathError] = useState('');
  const pathInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isCreating) newFolderInputRef.current?.focus();
  }, [isCreating]);

  useEffect(() => {
    if (editingPath) pathInputRef.current?.select();
  }, [editingPath]);

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
    setHistory([]);
    setSelectedPath(null);
    setRequestedPath(initialPath);
    setAttempt((value) => value + 1);
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

  const currentPath = listing?.path ?? requestedPath;
  const target = selectedPath ?? listing?.path ?? null;
  const busy = loading || creating;

  const navigate = (path: string, { recordHistory = true }: { recordHistory?: boolean } = {}) => {
    if (recordHistory && path !== currentPath) setHistory((entries) => [...entries, currentPath]);
    requestRef.current++;
    createRequestRef.current++;
    creatingRef.current = false;
    setCreating(false);
    setListing(null);
    setLoading(true);
    setError('');
    setSelectedPath(null);
    setRequestedPath(path);
    setIsCreating(false);
    setNewFolderName('');
    setCreateError('');
    setEditingPath(false);
    setPathError('');
    setAttempt((value) => value + 1);
    dialogRef.current?.focus();
  };

  const goBack = () => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory((entries) => entries.slice(0, -1));
    navigate(previous, { recordHistory: false });
  };

  const goUp = () => {
    if (listing?.parentPath) navigate(listing.parentPath);
  };

  const refresh = () => navigate(currentPath, { recordHistory: false });

  const startCreating = () => {
    setIsCreating(true);
    setNewFolderName('');
    setCreateError('');
  };

  const startEditingPath = () => {
    setPathDraft(currentPath);
    setPathError('');
    setEditingPath(true);
  };

  const submitPath = () => {
    const resolved = resolveTypedPath(pathDraft, homePath);
    if (!resolved) {
      setPathError('Enter an absolute path or a path starting with ~');
      return;
    }
    navigate(resolved);
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
      // Open the new folder so Select picks the host's canonical path for it.
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

  const rows = () => Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('.remote-chooser-row') ?? []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const inInput = event.target instanceof HTMLInputElement;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      startEditingPath();
      return;
    }
    if (inInput || creating) return;
    if (event.altKey && event.key === 'ArrowLeft') {
      event.preventDefault();
      goBack();
      return;
    }
    if ((event.altKey && event.key === 'ArrowUp') || event.key === 'Backspace' || event.key === 'ArrowLeft') {
      if (!listing?.parentPath) return;
      event.preventDefault();
      goUp();
      return;
    }
    if (event.key === 'Enter' && event.target === event.currentTarget && listing && !loading) {
      event.preventDefault();
      onSelect(listing.path);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const items = rows();
      if (!items.length) return;
      event.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        index < 0
          ? event.key === 'ArrowDown' ? 0 : items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      items[next]?.focus();
    }
  };

  const places = [
    homePath ? { id: 'home', label: 'Home', path: homePath, Icon: Home } : null,
    initialPath && initialPath !== homePath && initialPath !== '/'
      ? { id: 'start', label: baseName(initialPath), path: initialPath, Icon: FolderOpen }
      : null,
    { id: 'root', label: 'Filesystem', path: '/', Icon: HardDrive },
  ].filter((place): place is NonNullable<typeof place> => place !== null);

  const crumbs = getPathCrumbs(currentPath, homePath);

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
        onEscapeKeyDown={(event) => {
          // Escape first leaves inline editing; only a second Escape closes the chooser.
          if (editingPath) {
            event.preventDefault();
            setEditingPath(false);
            setPathError('');
            dialogRef.current?.focus();
          } else if (isCreating) {
            event.preventDefault();
            setIsCreating(false);
            setCreateError('');
            dialogRef.current?.focus();
          }
        }}
        onKeyDown={handleKeyDown}
      >
        <div className="remote-chooser-header clanker-dialog-header">
          <DialogTitle asChild>
            <strong className="clanker-dialog-title">Browse remote directories</strong>
          </DialogTitle>
          <DialogClose asChild>
            <IconButton variant="ghost" className="clanker-dialog-close" aria-label="Close remote browser" title="Close"><X size={14} /></IconButton>
          </DialogClose>
        </div>

        <div className="remote-chooser-toolbar">
          <div className="remote-chooser-nav" role="group" aria-label="Navigation">
            <IconButton size="xs" variant="ghost" aria-label="Back" title="Back (Alt+Left)"
              disabled={busy || history.length === 0} onClick={goBack}>
              <ArrowLeft size={14} />
            </IconButton>
            <IconButton size="xs" variant="ghost" aria-label="Parent directory" title="Up (Backspace)"
              disabled={busy || !listing?.parentPath} onClick={goUp}>
              <ArrowUp size={14} />
            </IconButton>
            <IconButton size="xs" variant="ghost" aria-label="Home directory" title="Home"
              disabled={busy || !homePath} onClick={() => navigate(homePath)}>
              <Home size={14} />
            </IconButton>
          </div>

          {editingPath ? (
            <form
              className="remote-chooser-location"
              onSubmit={(event) => {
                event.preventDefault();
                submitPath();
              }}
            >
              <Input
                ref={pathInputRef}
                variant="mono"
                className="remote-chooser-location-input"
                aria-label="Location"
                aria-invalid={pathError ? 'true' : undefined}
                value={pathDraft}
                onChange={(event) => {
                  setPathDraft(event.target.value);
                  setPathError('');
                }}
                onBlur={() => {
                  if (!pathError) setEditingPath(false);
                }}
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="off"
              />
            </form>
          ) : (
            <nav className="remote-chooser-crumbs" aria-label="Current location" onDoubleClick={startEditingPath}>
              {crumbs.map((crumb, index) => {
                const last = index === crumbs.length - 1;
                return (
                  <span key={crumb.path} className="remote-chooser-crumb-item">
                    {index > 0 && <ChevronRight className="remote-chooser-crumb-sep" size={12} aria-hidden="true" />}
                    <button
                      type="button"
                      className={`remote-chooser-crumb${last ? ' current' : ''}`}
                      aria-current={last ? 'location' : undefined}
                      title={crumb.path}
                      disabled={busy}
                      onClick={() => { if (!last) navigate(crumb.path); }}
                    >
                      {crumb.kind === 'home' && <Home size={12} aria-hidden="true" />}
                      {crumb.kind === 'root' ? <HardDrive size={12} aria-label="Filesystem root" /> : <span>{crumb.label}</span>}
                    </button>
                  </span>
                );
              })}
              <IconButton size="xs" variant="ghost" className="remote-chooser-edit" aria-label="Type a location"
                title="Type a location (Ctrl+L)" onClick={startEditingPath}>
                <Pencil size={12} />
              </IconButton>
            </nav>
          )}

          <div className="remote-chooser-nav" role="group" aria-label="Folder actions">
            <IconButton size="xs" variant="ghost" aria-label="Refresh" title="Refresh"
              disabled={busy} onClick={refresh}>
              <RefreshCw size={13} />
            </IconButton>
            <IconButton size="xs" variant="ghost" aria-label="New folder" title="New folder"
              disabled={busy || !listing} onClick={startCreating}>
              <FolderPlus size={14} />
            </IconButton>
          </div>
        </div>
        {pathError && <p className="remote-chooser-inline-error remote-chooser-path-error" role="alert">{pathError}</p>}

        <div className="remote-chooser-main">
          <nav className="remote-chooser-places" aria-label="Places">
            <span className="remote-chooser-places-title">Places</span>
            {places.map(({ id, label, path, Icon }) => (
              <button
                key={id}
                type="button"
                className={`remote-chooser-place${currentPath === path ? ' active' : ''}`}
                aria-current={currentPath === path ? 'location' : undefined}
                title={path}
                disabled={busy}
                onClick={() => navigate(path)}
              >
                <Icon size={14} aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </nav>

          <div className="remote-chooser-pane">
            <div className="remote-chooser-column-header" aria-hidden="true">Name</div>
            {isCreating && (
              <form
                className="remote-chooser-new-folder"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleCreateFolder();
                }}
              >
                <FolderPlus size={14} aria-hidden="true" />
                <Input
                  ref={newFolderInputRef}
                  className="remote-chooser-input"
                  aria-label="New folder name"
                  placeholder="Folder name"
                  value={newFolderName}
                  onChange={(event) => {
                    setNewFolderName(event.target.value);
                    setCreateError('');
                  }}
                  disabled={creating}
                  autoFocus
                />
                <Button size="xs" variant="primary" type="submit" disabled={creating || !newFolderName.trim()}>
                  {creating ? <Loader2 className="spin" size={12} /> : 'Create'}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
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
            <div ref={listRef} className="remote-chooser-list" role="listbox" aria-label="Directories">
              {loading && <p className="remote-chooser-status" role="status"><Loader2 className="spin" size={14} /> Loading directories…</p>}
              {error && (
                <p className="remote-chooser-status error" role="alert">
                  <AlertCircle size={14} aria-hidden="true" />
                  <span>{error}</span>
                  <Button size="xs" type="button" onClick={refresh}>Retry</Button>
                </p>
              )}
              {!loading && !error && listing?.directories.length === 0 && (
                <p className="remote-chooser-status empty">No subdirectories</p>
              )}
              {!loading && !error && listing?.directories.map((directory) => {
                const selected = directory.path === selectedPath;
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    key={directory.path}
                    className={`remote-chooser-row${selected ? ' selected' : ''}`}
                    title={`${directory.path}\nDouble-click to open`}
                    disabled={creating}
                    onFocus={() => setSelectedPath(directory.path)}
                    onClick={() => setSelectedPath(directory.path)}
                    onDoubleClick={() => navigate(directory.path)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === 'ArrowRight') {
                        event.preventDefault();
                        event.stopPropagation();
                        navigate(directory.path);
                      }
                    }}
                  >
                    <Folder size={14} aria-hidden="true" />
                    <span>{directory.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="remote-chooser-actions clanker-dialog-footer">
          <span className="remote-chooser-target" title={target ?? undefined}>
            {target && <><FolderOpen size={13} aria-hidden="true" /><span>{target}</span></>}
          </span>
          <DialogClose asChild>
            <Button size="sm" variant="secondary" type="button">
              Cancel
            </Button>
          </DialogClose>
          <Button
            size="sm"
            variant="primary"
            type="button"
            disabled={!target || busy}
            onClick={() => {
              if (target) onSelect(target);
            }}
          >
            Select folder
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
