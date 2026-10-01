import { useEffect, useRef, useState } from 'react';
import { Folder, FolderOpen, Loader2 } from 'lucide-react';
import RemoteDirectoryChooser from './RemoteDirectoryChooser';
import { joinPaths, normalizePath, relativePath } from '../lib/pathUtils';
import './RemoteDirectoryChooser.css';

interface Props {
  environmentId: string;
  path: string;
  onPathChange: (path: string) => void;
  onSubmit: () => void;
  relativeToBase?: boolean;
  onBaseDirectoryChange?: (path: string) => void;
}

export default function RemoteWorkspacePath({ environmentId, path, onPathChange, onSubmit, relativeToBase = false, onBaseDirectoryChange }: Props) {
  const [homePath, setHomePath] = useState('');
  const [basePath, setBasePath] = useState('');
  const [absoluteInput, setAbsoluteInput] = useState(false);
  const [homeLoading, setHomeLoading] = useState(true);
  const [homeError, setHomeError] = useState('');
  const [chooserOpen, setChooserOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{ name: string; path: string }>>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [focused, setFocused] = useState(false);
  const requestRef = useRef(0);
  const editedRef = useRef(false);
  const manualValueRef = useRef('');
  const inputRef = useRef<HTMLInputElement>(null);
  const browseButtonRef = useRef<HTMLButtonElement>(null);

  const closeChooser = () => {
    setChooserOpen(false);
    browseButtonRef.current?.focus();
  };

  useEffect(() => {
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
      } else if (!editedRef.current) onPathChange(initialPath || home);
    }).catch((reason: unknown) => {
      if (active) setHomeError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (active) setHomeLoading(false);
    });
    return () => { active = false; };
  }, [environmentId, onPathChange, relativeToBase, onBaseDirectoryChange]);

  useEffect(() => {
    const request = ++requestRef.current;
    const suggestionPath = path || (relativeToBase && basePath ? `${basePath.replace(/\/$/, '')}/` : '');
    if (!focused || !suggestionPath.startsWith('/')) return;
    const slash = suggestionPath.lastIndexOf('/');
    const directory = suggestionPath.endsWith('/') ? suggestionPath : suggestionPath.slice(0, slash + 1) || '/';
    const filter = suggestionPath.endsWith('/') ? '' : suggestionPath.slice(slash + 1).toLocaleLowerCase();
    const timer = setTimeout(() => {
      void window.electronAPI.sshListDirectories(environmentId, directory).then((listing) => {
        if (request !== requestRef.current) return;
        setSuggestions(listing.directories.filter((entry) => entry.name.toLocaleLowerCase().includes(filter)).slice(0, 8));
      }).catch(() => {
        if (request === requestRef.current) setSuggestions([]);
      });
    }, 200);
    return () => { clearTimeout(timer); };
  }, [environmentId, focused, path, relativeToBase, basePath]);

  const choose = (chosenPath: string) => {
    editedRef.current = true;
    manualValueRef.current = chosenPath;
    setAbsoluteInput(false);
    requestRef.current++;
    onPathChange(chosenPath);
    setSuggestions([]);
    setSelectedIndex(-1);
  };
  const waitingForBase = homeLoading && (!path || (relativeToBase && !path.startsWith('/')));

  return <>
    <div className="input-wrapper remote-path-input">
      <input ref={inputRef} type="text" className="gate-input" aria-label="Remote Directory Path"
        value={relativeToBase && basePath && !absoluteInput && path.startsWith('/') ? relativePath(basePath, path) || '.' : path}
        onChange={(event) => {
          const value = event.target.value;
          setAbsoluteInput(value.startsWith('/'));
          editedRef.current = true; manualValueRef.current = value; requestRef.current++;
          setSuggestions([]); setSelectedIndex(-1);
          onPathChange(relativeToBase && basePath && value && !value.startsWith('/') ? joinPaths(basePath, value) : value);
        }}
        onFocus={() => { setSuggestions([]); setFocused(true); }} onBlur={() => { requestRef.current++; setSuggestions([]); setFocused(false); }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && suggestions.length) { event.preventDefault(); setSuggestions([]); inputRef.current?.blur(); }
          else if (event.key === 'ArrowDown' && suggestions.length) { event.preventDefault(); setSelectedIndex((index) => (index + 1) % suggestions.length); }
          else if (event.key === 'ArrowUp' && suggestions.length) { event.preventDefault(); setSelectedIndex((index) => index <= 0 ? suggestions.length - 1 : index - 1); }
          else if (event.key === 'Enter') {
            event.preventDefault();
            if (selectedIndex >= 0 && suggestions[selectedIndex]) choose(suggestions[selectedIndex].path);
            else onSubmit();
          }
        }}
        placeholder={relativeToBase ? 'workspace directory' : 'Absolute remote directory'} spellCheck={false} autoComplete="off" autoCapitalize="off" />
      <button ref={browseButtonRef} type="button" className="cog-button" aria-label="Browse remote directories" title="Browse remote directories"
        disabled={!environmentId || waitingForBase} onClick={() => setChooserOpen(true)}>
        {waitingForBase ? <Loader2 size={18} className="spin" /> : <FolderOpen size={18} />}
      </button>
    </div>
    {homeError && <p role="alert" className="gate-directory-error">Could not load remote home: {homeError}. Enter an absolute path manually.</p>}
    {focused && suggestions.length > 0 && <ul className="suggestions-list remote-suggestions">
      {suggestions.map((entry, index) => <li key={entry.path}>
        <button type="button" className={`suggestion-item ${selectedIndex === index ? 'selected' : ''}`}
          onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setSelectedIndex(index)} onClick={() => choose(entry.path)}>
          <Folder size={14} className="suggestion-icon" /> <span className="suggestion-path" title={entry.path}>{relativeToBase && basePath ? `${relativePath(basePath, entry.path)}/` : entry.path}</span>
        </button>
      </li>)}
    </ul>}
    {chooserOpen && <RemoteDirectoryChooser environmentId={environmentId} initialPath={path.startsWith('/') ? path : basePath || homePath || '/'}
      homePath={homePath} onSelect={(chosen) => { choose(chosen); closeChooser(); }} onClose={closeChooser} />}
  </>;
}
