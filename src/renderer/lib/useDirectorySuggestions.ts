import { useCallback, useEffect, useRef, useState } from 'react';

export interface DirectorySuggestion { name: string; path: string }

const MAX_SUGGESTIONS = 8;
const DEBOUNCE_MS = 200;

/**
 * Type-ahead for directory paths: lists the parent of the text typed so far and filters by the last
 * segment. `suggestionPath` must already be absolute POSIX-style (or '' to suggest nothing); `list`
 * must be referentially stable. Results from superseded requests are dropped.
 */
export function useDirectorySuggestions(
  suggestionPath: string,
  active: boolean,
  list: (directory: string) => Promise<DirectorySuggestion[]>,
) {
  const [suggestions, setSuggestions] = useState<DirectorySuggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const requestRef = useRef(0);

  /** Clears the list and invalidates any lookup still in flight. */
  const dismiss = useCallback(() => {
    requestRef.current++;
    setSuggestions([]);
    setSelectedIndex(-1);
  }, []);

  useEffect(() => {
    const request = ++requestRef.current;
    if (!active || !suggestionPath) return;
    const slash = suggestionPath.lastIndexOf('/');
    const directory = suggestionPath.endsWith('/') ? suggestionPath : suggestionPath.slice(0, slash + 1) || '/';
    const filter = suggestionPath.endsWith('/') ? '' : suggestionPath.slice(slash + 1).toLocaleLowerCase();
    const timer = setTimeout(() => {
      void list(directory).then((entries) => {
        if (request !== requestRef.current) return;
        setSuggestions(entries.filter((entry) => entry.name.toLocaleLowerCase().includes(filter)).slice(0, MAX_SUGGESTIONS));
      }).catch(() => {
        if (request === requestRef.current) setSuggestions([]);
      });
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); };
  }, [active, suggestionPath, list]);

  return { suggestions, selectedIndex, setSelectedIndex, dismiss };
}

/** A path that ends in a separator lists its children; this is also how a chosen folder is continued. */
export const withTrailingSlash = (value: string): string => value.endsWith('/') ? value : `${value}/`;

/** Submitted paths carry no trailing separator, except the filesystem root. */
export const withoutTrailingSlash = (value: string): string => value.length > 1 ? value.replace(/\/+$/, '') || '/' : value;
