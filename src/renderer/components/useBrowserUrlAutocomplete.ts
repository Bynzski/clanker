import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import type { BrowserHistoryEntry } from '../../shared/types/browserHistory';

interface UseBrowserUrlAutocompleteOptions {
  displayedUrl: string;
  activeTabId: string | null;
  getHistory: (query: string) => Promise<BrowserHistoryEntry[]>;
  onNavigate: (url: string) => Promise<string | null>;
}

interface UseBrowserUrlAutocompleteResult {
  inputUrl: string;
  historySuggestions: BrowserHistoryEntry[];
  highlightedSuggestionIndex: number;
  handleInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  handleInputFocus: () => void;
  handleInputBlur: () => void;
  handleInputKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  setHighlightedSuggestionIndex: (index: number) => void;
  handleSuggestionClick: (entry: BrowserHistoryEntry) => void;
  submitUrl: () => Promise<void>;
  syncDisplayedUrl: (url: string) => void;
  resetAutocompleteState: () => void;
}

export function useBrowserUrlAutocomplete({
  displayedUrl,
  activeTabId,
  getHistory,
  onNavigate,
}: UseBrowserUrlAutocompleteOptions): UseBrowserUrlAutocompleteResult {
  const [inputUrl, setInputUrl] = useState(displayedUrl);
  const [urlInputFocused, setUrlInputFocused] = useState(false);
  const [historySuggestions, setHistorySuggestions] = useState<BrowserHistoryEntry[]>([]);
  const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] = useState(0);
  const urlUserEditedRef = useRef(false);
  const blurSuggestionsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSuggestions = useCallback(() => {
    setHistorySuggestions([]);
    setHighlightedSuggestionIndex(0);
  }, []);

  const navigateTo = useCallback(async (url: string) => {
    const navigatedUrl = await onNavigate(url);
    if (!navigatedUrl) {
      return;
    }

    clearSuggestions();
    setInputUrl(navigatedUrl);
    urlUserEditedRef.current = false;
  }, [clearSuggestions, onNavigate]);

  const submitUrl = useCallback(async () => {
    await navigateTo(inputUrl);
  }, [inputUrl, navigateTo]);

  const handleSuggestionClick = useCallback((entry: BrowserHistoryEntry) => {
    void navigateTo(entry.url);
  }, [navigateTo]);

  const handleInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    const keyHandlers: Partial<Record<string, () => void>> = {
      ArrowDown: () => {
        if (historySuggestions.length === 0) return;
        setHighlightedSuggestionIndex((index) => (index + 1) % historySuggestions.length);
      },
      ArrowUp: () => {
        if (historySuggestions.length === 0) return;
        setHighlightedSuggestionIndex((index) => (index - 1 + historySuggestions.length) % historySuggestions.length);
      },
      Escape: () => {
        clearSuggestions();
      },
      Enter: () => {
        const highlighted = historySuggestions[highlightedSuggestionIndex];
        if (highlighted) {
          void navigateTo(highlighted.url);
          return;
        }

        void submitUrl();
      },
    };

    const handler = keyHandlers[event.key];
    if (handler) {
      event.preventDefault();
      handler();
    }
  }, [clearSuggestions, highlightedSuggestionIndex, historySuggestions, navigateTo, submitUrl]);

  const handleInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    urlUserEditedRef.current = true;
    setInputUrl(nextValue);
    if (nextValue.trim().length < 2) {
      clearSuggestions();
    }
  }, [clearSuggestions]);

  const handleInputFocus = useCallback(() => {
    if (blurSuggestionsTimerRef.current != null) {
      clearTimeout(blurSuggestionsTimerRef.current);
      blurSuggestionsTimerRef.current = null;
    }
    setUrlInputFocused(true);
  }, []);

  const handleInputBlur = useCallback(() => {
    blurSuggestionsTimerRef.current = setTimeout(() => {
      setUrlInputFocused(false);
      clearSuggestions();
    }, 120);
  }, [clearSuggestions]);

  useEffect(() => {
    const query = inputUrl.trim();
    if (!urlInputFocused || !urlUserEditedRef.current || query.length < 2) {
      return;
    }

    let cancelled = false;
    const timeoutId = setTimeout(() => {
      getHistory(query)
        .then((entries) => {
          if (cancelled) return;
          setHistorySuggestions(entries);
          setHighlightedSuggestionIndex(0);
        })
        .catch(() => {
          if (!cancelled) {
            clearSuggestions();
          }
        });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [activeTabId, clearSuggestions, getHistory, inputUrl, urlInputFocused]);

  useEffect(() => {
    return () => {
      if (blurSuggestionsTimerRef.current != null) {
        clearTimeout(blurSuggestionsTimerRef.current);
      }
    };
  }, []);

  const syncDisplayedUrl = useCallback((url: string) => {
    setInputUrl(url);
  }, []);

  const resetAutocompleteState = useCallback(() => {
    clearSuggestions();
    urlUserEditedRef.current = false;
  }, [clearSuggestions]);

  return {
    inputUrl,
    historySuggestions,
    highlightedSuggestionIndex,
    handleInputChange,
    handleInputFocus,
    handleInputBlur,
    handleInputKeyDown,
    setHighlightedSuggestionIndex,
    handleSuggestionClick,
    submitUrl,
    syncDisplayedUrl,
    resetAutocompleteState,
  };
}
