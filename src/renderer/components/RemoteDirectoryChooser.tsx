import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Folder, Loader2, X } from 'lucide-react';
import type { RemoteDirectoryListing } from '../../shared/types/environments';
import './RemoteDirectoryChooser.css';

interface Props {
  environmentId: string;
  initialPath: string;
  homePath: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

export default function RemoteDirectoryChooser({ environmentId, initialPath, homePath, onSelect, onClose }: Props) {
  const [listing, setListing] = useState<RemoteDirectoryListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestRef = useRef(0);
  const [requestedPath, setRequestedPath] = useState(initialPath);
  const [attempt, setAttempt] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

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
    setListing(null);
    setLoading(true);
    setError('');
    setRequestedPath(path);
    setAttempt((previous) => previous + 1);
    dialogRef.current?.focus();
  };

  return (
    <div className="remote-chooser-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div ref={dialogRef} tabIndex={-1} className="remote-chooser" role="dialog" aria-modal="true" aria-label="Browse remote directories" onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); onClose(); return; }
        if ((event.key === 'Backspace' || event.key === 'ArrowLeft') && listing?.parentPath
          && !(event.target instanceof HTMLInputElement)) {
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
          const next = index < 0
            ? event.key === 'ArrowDown' ? 0 : items.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
          items[next]?.focus();
        }
      }}>
        <div className="remote-chooser-header">
          <strong>Browse remote directories</strong>
          <button type="button" aria-label="Close remote browser" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="remote-chooser-toolbar">
          <button type="button" aria-label="Parent directory" disabled={loading || !listing?.parentPath} onClick={() => {
            if (listing?.parentPath) navigate(listing.parentPath);
          }}><ArrowLeft size={14} /> Parent</button>
          <button type="button" onClick={() => navigate(homePath)} disabled={loading || !homePath}>Home</button>
          <span title={listing?.path ?? requestedPath}>{listing?.path ?? requestedPath}</span>
        </div>
        <div className="remote-chooser-list">
          {loading && <p role="status"><Loader2 className="spin" size={15} /> Loading directories…</p>}
          {error && <p role="alert">{error} <button type="button" onClick={() => navigate(requestedPath)}>Retry</button></p>}
          {!loading && !error && listing?.directories.length === 0 && <p>No subdirectories</p>}
          {!loading && !error && listing?.directories.map((directory) => (
            <button type="button" key={directory.path} onClick={() => navigate(directory.path)}>
              <Folder size={15} /> {directory.name}
            </button>
          ))}
        </div>
        <div className="remote-chooser-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" disabled={!listing || loading} onClick={() => {
            if (listing) onSelect(listing.path);
          }}>Select this directory</button>
        </div>
      </div>
    </div>
  );
}
