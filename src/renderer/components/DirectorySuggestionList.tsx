import { Folder } from 'lucide-react';
import type { DirectorySuggestion } from '../lib/useDirectorySuggestions';
import './RemoteDirectoryChooser.css';
import './WorkspaceLocation.css';

/** Floating type-ahead list under a path input; it overlays the dialog so results never resize it. */
export default function DirectorySuggestionList({ suggestions, selectedIndex, onHover, onChoose, label = (entry) => entry.path }: {
  suggestions: DirectorySuggestion[];
  selectedIndex: number;
  onHover: (index: number) => void;
  onChoose: (entry: DirectorySuggestion) => void;
  label?: (entry: DirectorySuggestion) => string;
}) {
  if (suggestions.length === 0) return null;
  return <ul className="suggestions-list remote-suggestions">
    {suggestions.map((entry, index) => <li key={entry.path}>
      <button type="button" className={`suggestion-item ${selectedIndex === index ? 'selected' : ''}`}
        onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => onHover(index)} onClick={() => onChoose(entry)}>
        <Folder size={14} className="suggestion-icon" /> <span className="suggestion-path" title={entry.path}>{label(entry)}</span>
      </button>
    </li>)}
  </ul>;
}
