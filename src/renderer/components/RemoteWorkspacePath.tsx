import { useEffect, useRef, useState } from 'react';
import { Folder, FolderOpen, Loader2 } from 'lucide-react';
import RemoteDirectoryChooser from './RemoteDirectoryChooser';
import './RemoteDirectoryChooser.css';

interface Props {
  environmentId: string;
  path: string;
  onPathChange: (path: string) => void;
  onSubmit: () => void;
}

export default function RemoteWorkspacePath({ environmentId, path, onPathChange, onSubmit }: Props) {
  const [homePath, setHomePath] = useState('');
  const [homeLoading, setHomeLoading] = useState(true);
  const [homeError, setHomeError] = useState('');
  const [chooserOpen, setChooserOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{ name: string; path: string }>>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [focused, setFocused] = useState(false);
  const requestRef = useRef(0);
  const editedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const browseButtonRef = useRef<HTMLButtonElement>(null);

  const closeChooser = () => {
    setChooserOpen(false);
    browseButtonRef.current?.focus();
  };

  useEffect(() => {
    let active = true;
    void window.electronAPI.sshGetHomeDirectory(environmentId).then(({ homePath: home, initialPath }) => {
      if (!active) return;
      setHomePath(home);
      setHomeError('');
      if (!editedRef.current) onPathChange(initialPath || home);
    }).catch((reason: unknown) => {
      if (active) setHomeError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (active) setHomeLoading(false);
    });
    return () => { active = false; };
  }, [environmentId, onPathChange]);

  useEffect(() => {
    const request = ++requestRef.current;
    if (!focused || !path.startsWith('/')) return;
    const slash = path.lastIndexOf('/');
    const directory = path.endsWith('/') ? path : path.slice(0, slash + 1) || '/';
    const filter = path.endsWith('/') ? '' : path.slice(slash + 1).toLocaleLowerCase();
    const timer = setTimeout(() => {
      void window.electronAPI.sshListDirectories(environmentId, directory).then((listing) => {
        if (request !== requestRef.current) return;
        setSuggestions(listing.directories.filter((entry) => entry.name.toLocaleLowerCase().includes(filter)).slice(0, 8));
      }).catch(() => {
        if (request === requestRef.current) setSuggestions([]);
      });
    }, 200);
    return () => { clearTimeout(timer); };
  }, [environmentId, focused, path]);

  const choose = (chosenPath: string) => {
    editedRef.current = true;
    requestRef.current++;
    onPathChange(chosenPath);
    setSuggestions([]);
    setSelectedIndex(-1);
  };

  return <>
    <div className="input-wrapper remote-path-input">
      <input ref={inputRef} type="text" className="gate-input" aria-label="Remote Directory Path"
        value={path} onChange={(event) => { editedRef.current = true; requestRef.current++; setSuggestions([]); setSelectedIndex(-1); onPathChange(event.target.value); }}
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
        placeholder="/home/jay/Projects/clanker" spellCheck={false} autoComplete="off" autoCapitalize="off" />
      <button ref={browseButtonRef} type="button" className="cog-button" aria-label="Browse remote directories" title="Browse remote directories"
        disabled={!environmentId || homeLoading && !path} onClick={() => setChooserOpen(true)}>
        {homeLoading && !path ? <Loader2 size={18} className="spin" /> : <FolderOpen size={18} />}
      </button>
    </div>
    {homeError && <p role="alert" className="gate-directory-error">Could not load remote home: {homeError}. Enter a path manually.</p>}
    {focused && suggestions.length > 0 && <ul className="suggestions-list remote-suggestions">
      {suggestions.map((entry, index) => <li key={entry.path}>
        <button type="button" className={`suggestion-item ${selectedIndex === index ? 'selected' : ''}`}
          onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setSelectedIndex(index)} onClick={() => choose(entry.path)}>
          <Folder size={14} className="suggestion-icon" /> <span className="suggestion-path">{entry.path}</span>
        </button>
      </li>)}
    </ul>}
    {chooserOpen && <RemoteDirectoryChooser environmentId={environmentId} initialPath={path.startsWith('/') ? path : homePath || '/'}
      homePath={homePath} onSelect={(chosen) => { choose(chosen); closeChooser(); }} onClose={closeChooser} />}
  </>;
}
