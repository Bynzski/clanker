import { useState, useEffect, useRef, useCallback } from 'react';
import { FolderOpen, Folder, Loader2, Brain, Zap, Pi, Play, ChevronRight, Terminal } from 'lucide-react';
import './WorkspaceGate.css';

export interface WorkspaceFormData {
  path: string;
  terminalCount: number;
  harness: string;
}

interface ContentProps {
  initialPath?: string;
  onSubmit: (data: WorkspaceFormData) => void;
}

const STORAGE_KEY = 'clanker-grid-last-path';

export const TERMINAL_PRESETS = [
  { count: 1, label: '1', description: 'Single terminal' },
  { count: 2, label: '2', description: 'Two terminals' },
  { count: 4, label: '4', description: 'Four terminals' },
];

export const HARNESS_OPTIONS = [
  { id: '', label: 'Terminal', Icon: Terminal },
  { id: 'codex', label: 'Codex', Icon: Brain },
  { id: 'opencode', label: 'OpenCode', Icon: Zap },
  { id: 'pi', label: 'Pi', Icon: Pi },
];

export default function WorkspaceGateContent({ initialPath, onSubmit }: ContentProps) {
  const [inputValue, setInputValue] = useState(initialPath || '');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState(2); // Default to 2 (index 2)
  const [selectedHarness, setSelectedHarness] = useState('codex'); // Default to codex
  
  const inputRef = useRef<HTMLInputElement>(null);

  // Load last used path
  useEffect(() => {
    if (initialPath) {
      setInputValue(initialPath);
      return;
    }
    
    const loadPath = async () => {
      try {
        const lastPath = localStorage.getItem(STORAGE_KEY);
        if (lastPath) {
          setInputValue(lastPath);
        } else {
          const defaultPath = await window.electronAPI.getLastWorkspace();
          setInputValue(defaultPath || '/home/');
        }
      } catch {
        setInputValue('/home/');
      }
    };
    loadPath();
  }, [initialPath]);

  // Fetch directory suggestions
  const fetchSuggestions = useCallback(async (path: string) => {
    if (!path || path === '/') {
      setSuggestions([]);
      return;
    }

    const basePath = path.endsWith('/') ? path.slice(0, -1) : path;
    const lastSlash = basePath.lastIndexOf('/');
    
    if (lastSlash <= 0) {
      setSuggestions([]);
      return;
    }

    const dirPath = basePath.substring(0, lastSlash + 1);
    const prefix = basePath.substring(lastSlash + 1).toLowerCase();

    try {
      const entries = await window.electronAPI.readDirectory(dirPath);
      
      const dirs = entries
        .filter(entry => entry.isDirectory)
        .map(entry => dirPath + entry.name + '/')
        .filter(name => {
          const nameWithoutSlash = name.slice(0, -1);
          const lastPart = nameWithoutSlash.substring(nameWithoutSlash.lastIndexOf('/') + 1);
          return lastPart.toLowerCase().includes(prefix);
        })
        .sort((a, b) => {
          const aName = a.slice(0, -1).split('/').pop() || '';
          const bName = b.slice(0, -1).split('/').pop() || '';
          if (aName.length !== bName.length) return aName.length - bName.length;
          return aName.localeCompare(bName);
        })
        .slice(0, 8);

      setSuggestions(dirs);
    } catch {
      setSuggestions([]);
    }
  }, []);

  // Debounced fetch on input change
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchSuggestions(inputValue);
    }, 150);
    return () => clearTimeout(timer);
  }, [inputValue, fetchSuggestions]);

  const handleOpenDirectory = async () => {
    setIsLoading(true);

    try {
      const selected = await window.electronAPI.openDirectoryDialog();
      if (selected) {
        const path = selected.endsWith('/') ? selected : selected + '/';
        setInputValue(path);
        setSuggestions([]);
        localStorage.setItem(STORAGE_KEY, path);
      }
    } catch (err) {
      console.error('Failed to open directory:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = () => {
    const path = inputValue.trim();
    if (!path) return;

    const finalPath = path.endsWith('/') ? path : path + '/';
    
    if (!finalPath.startsWith('/')) {
      return;
    }

    localStorage.setItem(STORAGE_KEY, finalPath);
    const preset = TERMINAL_PRESETS[selectedPreset];
    onSubmit({
      path: finalPath,
      terminalCount: preset.count,
      harness: selectedHarness,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && suggestions[selectedIndex]) {
        setInputValue(suggestions[selectedIndex]);
        setSuggestions([]);
        setSelectedIndex(-1);
        localStorage.setItem(STORAGE_KEY, suggestions[selectedIndex]);
      } else {
        handleSubmit();
      }
    } else if (e.key === 'Tab' && suggestions.length > 0) {
      e.preventDefault();
      const index = selectedIndex >= 0 ? selectedIndex : 0;
      setInputValue(suggestions[index]);
      setSelectedIndex(index);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (suggestions.length > 0) {
        setSelectedIndex(prev => prev < suggestions.length - 1 ? prev + 1 : 0);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (suggestions.length > 0) {
        setSelectedIndex(prev => prev > 0 ? prev - 1 : suggestions.length - 1);
      }
    } else if (e.key === 'Escape') {
      setSuggestions([]);
      setSelectedIndex(-1);
      inputRef.current?.blur();
    } else if (e.key === '1' && !isFocused) {
      e.preventDefault();
      setSelectedPreset(0);
    } else if (e.key === '2' && !isFocused) {
      e.preventDefault();
      setSelectedPreset(1);
    } else if (e.key === '4' && !isFocused) {
      e.preventDefault();
      setSelectedPreset(2);
    } else if ((e.key === 'b' || e.key === 'B') && !isFocused && harness !== '') {
      e.preventDefault();
      setSelectedHarness('');
    } else if ((e.key === 'c' || e.key === 'C') && !isFocused) {
      e.preventDefault();
      setSelectedHarness('codex');
    } else if ((e.key === 'o' || e.key === 'O') && !isFocused) {
      e.preventDefault();
      setSelectedHarness('opencode');
    } else if ((e.key === 'p' || e.key === 'P') && !isFocused && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      setSelectedHarness('pi');
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInputValue(suggestion);
    setSuggestions([]);
    setSelectedIndex(-1);
    localStorage.setItem(STORAGE_KEY, suggestion);
    inputRef.current?.focus();
  };

  const showSuggestions = isFocused && suggestions.length > 0;

  return (
    <div className="gate-content">
      <div className="gate-icon">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M3 9H21" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M9 21V9" stroke="currentColor" strokeWidth="1.5"/>
        </svg>
      </div>
      
      <h1 className="gate-title">Clanker Grid</h1>
      <p className="gate-subtitle">Developer Workspace Launcher</p>
      
      <div className="gate-input-container">
        <div className="input-wrapper">
          <input
            ref={inputRef}
            type="text"
            className="gate-input"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              setSelectedIndex(-1);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setTimeout(() => setIsFocused(false), 200)}
            placeholder="/home/username/projects/"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
          />
          <button 
            className="cog-button"
            onClick={handleOpenDirectory}
            disabled={isLoading}
            title="Browse directories"
          >
            {isLoading ? (
              <Loader2 size={18} className="spin" />
            ) : (
              <FolderOpen size={18} strokeWidth={2} />
            )}
          </button>
        </div>
        
        {showSuggestions && (
          <ul className="suggestions-list">
            {suggestions.map((suggestion, index) => (
              <li
                key={suggestion}
                className={`suggestion-item ${index === selectedIndex ? 'selected' : ''}`}
                onClick={() => handleSuggestionClick(suggestion)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <Folder size={14} strokeWidth={2} className="suggestion-icon" />
                <span className="suggestion-path">{suggestion}</span>
                <ChevronRight size={12} className="suggestion-arrow" />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="harness-selector">
        <span className="harness-selector-label">Harness</span>
        <div className="harness-options">
          {HARNESS_OPTIONS.map((harness) => (
            <button
              key={harness.id}
              className={`harness-option ${selectedHarness === harness.id ? 'selected' : ''}`}
              onClick={() => setSelectedHarness(harness.id)}
              title={harness.id ? `Press ${harness.id[0].toUpperCase()} to select` : 'No harness (basic terminal)'}
            >
              <harness.Icon size={20} strokeWidth={2} className="harness-icon" />
              <span className="harness-label">{harness.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid-selector">
        <span className="grid-selector-label">Terminals</span>
        <div className="grid-options">
          {TERMINAL_PRESETS.map((preset, index) => (
            <button
              key={preset.count}
              className={`grid-option ${selectedPreset === index ? 'selected' : ''}`}
              onClick={() => setSelectedPreset(index)}
              title={`Press ${preset.label} to select`}
            >
              <span className="preset-count">{preset.count}</span>
              <span className="grid-label">{preset.label} terminal{preset.count > 1 ? 's' : ''}</span>
            </button>
          ))}
        </div>
      </div>

      <button 
        className="gate-button"
        onClick={handleSubmit}
      >
        <Play size={16} strokeWidth={2.5} fill="currentColor" />
        Launch Workspace
      </button>

      <div className="gate-shortcuts">
        <span className="shortcut">
          <kbd>Tab</kbd> autocomplete
        </span>
        <span className="shortcut">
          <kbd>B</kbd><kbd>C</kbd><kbd>O</kbd><kbd>P</kbd> harness
        </span>
        <span className="shortcut">
          <kbd>↵</kbd> launch
        </span>
      </div>
    </div>
  );
}
