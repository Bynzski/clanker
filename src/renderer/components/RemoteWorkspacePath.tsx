import { IconButton } from './ui/IconButton';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { FolderOpen, Loader2 } from 'lucide-react';
import DirectorySuggestionList from './DirectorySuggestionList';
import { useDirectorySuggestions, withTrailingSlash } from '../lib/useDirectorySuggestions';
import RemoteDirectoryChooser from './RemoteDirectoryChooser';
import { joinPaths, normalizePath, relativePath } from '../lib/pathUtils';
import './RemoteDirectoryChooser.css';
import './WorkspaceLocation.css';

interface Props {
  environmentId: string;
  path: string;
  onPathChange: (path: string) => void;
  onSubmit: () => void;
  relativeToBase?: boolean;
  onBaseDirectoryChange?: (path: string) => void;
  /** Rendered inside the input group before the input. */
  leadingAction?: ReactNode;
}

export default function RemoteWorkspacePath({ environmentId, path, onPathChange, onSubmit, relativeToBase = false, onBaseDirectoryChange, leadingAction }: Props) {
  const [homePath, setHomePath] = useState('');
  const [basePath, setBasePath] = useState('');
  const [absoluteInput, setAbsoluteInput] = useState(false);
  const [homeLoading, setHomeLoading] = useState(true);
  const [homeError, setHomeError] = useState('');
  const [homeAttempt, setHomeAttempt] = useState(0);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const editedRef = useRef(false);
  const manualValueRef = useRef('');
  const inputRef = useRef<HTMLInputElement>(null);
  const browseButtonRef = useRef<HTMLButtonElement>(null);

  const closeChooser = () => {
    setChooserOpen(false);
    browseButtonRef.current?.focus();
  };

  useEffect(() => {
    // Each run owns its result: a new environment or Retry supersedes any in-flight lookup.
    let active = true;
    onBaseDirectoryChange?.('');
    void window.electronAPI.sshGetHomeDirectory(environmentId).then(({ homePath: home, initialPath }) => {
      if (!active) return;
      setHomePath(home);
      const base = normalizePath(initialPath || home);
      setBasePath(base);
      onBaseDirectoryChange?.(base);
      setHomeError('');
      if (relativeToBase) {
        if (!editedRef.current) onPathChange('');
        else if (manualValueRef.current && !manualValueRef.current.startsWith('/')) {
          onPathChange(joinPaths(base, manualValueRef.current));
        }
      } else if (!editedRef.current) onPathChange(withTrailingSlash(initialPath || home));
    }).catch((reason: unknown) => {
      if (active) setHomeError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (active) setHomeLoading(false);
    });
    return () => { active = false; };
  }, [environmentId, homeAttempt, onPathChange, relativeToBase, onBaseDirectoryChange]);

  const suggestionPath = path || (relativeToBase && basePath ? `${basePath.replace(/\/$/, '')}/` : '');
  const listDirectories = useCallback((directory: string) => window.electronAPI.sshListDirectories(environmentId, directory)
    .then((listing) => listing.directories), [environmentId]);
  const { suggestions, selectedIndex, setSelectedIndex, dismiss, settle, wake, settled } = useDirectorySuggestions(
    suggestionPath.startsWith('/') ? suggestionPath : '', focused, listDirectories);

  const choose = (chosenPath: string) => {
    editedRef.current = true;
    manualValueRef.current = chosenPath;
    setAbsoluteInput(false);
    settle();
    onPathChange(withTrailingSlash(chosenPath));
  };
  const waitingForBase = homeLoading && (!path || (relativeToBase && !path.startsWith('/')));

  return <div className="remote-path-field">
    <div className="input-wrapper remote-path-input">
      {leadingAction}
      <Input variant="mono" ref={inputRef} type="text" className="workspace-location-input" aria-label="Remote Directory Path"
        value={relativeToBase && basePath && !absoluteInput && path.startsWith('/') ? relativePath(basePath, path) || '.' : path}
        onChange={(event) => {
          const value = event.target.value;
          setAbsoluteInput(value.startsWith('/'));
          editedRef.current = true; manualValueRef.current = value;
          wake(); dismiss();
          onPathChange(relativeToBase && basePath && value && !value.startsWith('/') ? joinPaths(basePath, value) : value);
        }}
        onClick={() => wake()}
        onFocus={() => { dismiss(); setFocused(true); }} onBlur={() => { dismiss(); setFocused(false); }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && suggestions.length) { event.preventDefault(); dismiss(); inputRef.current?.blur(); }
          else if (event.key === 'ArrowDown' && settled) { event.preventDefault(); wake(); }
          else if (event.key === 'ArrowDown' && suggestions.length) { event.preventDefault(); setSelectedIndex((index) => (index + 1) % suggestions.length); }
          else if (event.key === 'ArrowUp' && suggestions.length) { event.preventDefault(); setSelectedIndex((index) => index <= 0 ? suggestions.length - 1 : index - 1); }
          else if (event.key === 'Enter') {
            event.preventDefault();
            if (selectedIndex >= 0 && suggestions[selectedIndex]) choose(suggestions[selectedIndex].path);
            else onSubmit();
          }
        }}
        placeholder={relativeToBase ? 'workspace directory' : 'Absolute remote directory'} spellCheck={false} autoComplete="off" autoCapitalize="off" />
      <IconButton ref={browseButtonRef} type="button" className="cog-button" aria-label="Browse remote directories" title="Browse remote directories"
        disabled={!environmentId || waitingForBase} onClick={() => setChooserOpen(true)}>
        {waitingForBase ? <Loader2 size={18} className="spin" /> : <FolderOpen size={18} />}
      </IconButton>
    </div>
    {homeError && <p role="alert" className="workspace-location-error">Could not load remote home: {homeError}. Enter an absolute path manually. <Button type="button" onClick={() => { setHomeError(''); setHomeLoading(true); setHomeAttempt((attempt) => attempt + 1); }}>Retry</Button></p>}
    {focused && <DirectorySuggestionList suggestions={suggestions} selectedIndex={selectedIndex} onHover={setSelectedIndex} onChoose={(entry) => choose(entry.path)}
      label={(entry) => relativeToBase && basePath ? `${relativePath(basePath, entry.path)}/` : entry.path} />}
    {chooserOpen && <RemoteDirectoryChooser environmentId={environmentId} initialPath={path.startsWith('/') ? path : basePath || homePath || '/'}
      homePath={homePath} triggerRef={browseButtonRef} onSelect={(chosen) => { choose(chosen); closeChooser(); }} onClose={closeChooser} />}
  </div>;
}
