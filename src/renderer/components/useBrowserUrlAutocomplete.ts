import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FocusEvent, KeyboardEvent } from 'react';
import type { BrowserHistorySuggestion } from '../../shared/types/browserHistory';
import { resolveBrowserAddress } from '../lib/browserAddress';

interface UseBrowserUrlAutocompleteOptions {
  displayedUrl: string;
  activeTabId: string | null;
  getHistory: (query: string) => Promise<BrowserHistorySuggestion[]>;
  onNavigate: (url: string) => Promise<string | null>;
}

export function useBrowserUrlAutocomplete({
  displayedUrl,
  activeTabId,
  getHistory,
  onNavigate,
}: UseBrowserUrlAutocompleteOptions) {
  const [inputUrl, setInputUrl] = useState(displayedUrl);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [historySuggestions, setHistorySuggestions] = useState<BrowserHistorySuggestion[]>([]);
  // -1 is the typed Search/Open action. History always requires explicit selection.
  const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] = useState(-1);
  const [inputError, setInputError] = useState('');
  const interactionRef = useRef(0);
  const queryRef = useRef(0);
  const addressAction = resolveBrowserAddress(inputUrl);
  const primaryAction = suggestionsOpen && addressAction?.kind !== 'invalid' ? addressAction : null;

  const clearSuggestions = useCallback(() => {
    queryRef.current++;
    setHistorySuggestions([]);
    setHighlightedSuggestionIndex(-1);
  }, []);

  const dismissSuggestions = useCallback(() => {
    clearSuggestions();
    setSuggestionsOpen(false);
  }, [clearSuggestions]);

  const navigateTo = useCallback(async (url: string) => {
    const interaction = ++interactionRef.current;
    dismissSuggestions();
    setInputError('');
    try {
      const navigatedUrl = await onNavigate(url);
      if (interaction !== interactionRef.current) return;
      if (navigatedUrl) setInputUrl(navigatedUrl);
      else setInputError('Could not open this address. Check the URL or file path.');
    } catch {
      if (interaction === interactionRef.current) setInputError('Could not open this address. Try again.');
    }
  }, [dismissSuggestions, onNavigate]);

  const submitUrl = useCallback(async () => {
    const highlighted = historySuggestions[highlightedSuggestionIndex];
    if (highlighted) {
      await navigateTo(highlighted.url);
    } else if (addressAction?.kind === 'invalid') {
      dismissSuggestions();
      setInputError(addressAction.error);
    } else if (addressAction) {
      await navigateTo(addressAction.url);
    }
  }, [addressAction, dismissSuggestions, highlightedSuggestionIndex, historySuggestions, navigateTo]);

  const handleSuggestionClick = useCallback((entry: BrowserHistorySuggestion) => {
    void navigateTo(entry.url);
  }, [navigateTo]);

  const handlePrimaryActionClick = useCallback(() => {
    if (addressAction && addressAction.kind !== 'invalid') void navigateTo(addressAction.url);
  }, [addressAction, navigateTo]);

  const handleInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    // Enter during an IME composition must finish composing, never navigate.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setSuggestionsOpen(true);
      const first = primaryAction ? -1 : 0;
      if (historySuggestions.length) {
        setHighlightedSuggestionIndex(index => event.key === 'ArrowDown'
          ? index >= historySuggestions.length - 1 ? first : index + 1
          : index <= first ? historySuggestions.length - 1 : index - 1);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      dismissSuggestions();
      setInputError('');
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void submitUrl();
    }
  }, [dismissSuggestions, historySuggestions.length, primaryAction, submitUrl]);

  const handleInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    interactionRef.current++;
    clearSuggestions();
    setInputError('');
    setInputUrl(event.target.value);
    setSuggestionsOpen(true);
  }, [clearSuggestions]);

  const handleInputFocus = useCallback(() => {
    setSuggestionsOpen(true);
  }, []);

  const handleInputBlur = useCallback((event: FocusEvent<HTMLElement>) => {
    // Suggestion mousedown keeps input focus; no delayed blur or lost Go selection.
    if (event.relatedTarget instanceof HTMLElement && event.relatedTarget.closest('.browser-go-btn')) return;
    dismissSuggestions();
    setInputError('');
  }, [dismissSuggestions]);

  useEffect(() => {
    const query = inputUrl.trim();
    if (!suggestionsOpen || (query.length > 0 && query.length < 2)) return;
    const version = ++queryRef.current;
    let cancelled = false;
    const timeoutId = setTimeout(() => {
      getHistory(query).then(entries => {
        if (cancelled || queryRef.current !== version) return;
        setHistorySuggestions(entries);
        setHighlightedSuggestionIndex(-1);
      }).catch(() => {
        if (!cancelled && queryRef.current === version) clearSuggestions();
      });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [activeTabId, clearSuggestions, getHistory, inputUrl, suggestionsOpen]);

  useEffect(() => {
    const interaction = interactionRef;
    return () => { interaction.current++; };
  }, []);

  const syncDisplayedUrl = useCallback((url: string) => {
    interactionRef.current++;
    setInputUrl(url);
  }, []);

  const resetAutocompleteState = useCallback(() => {
    interactionRef.current++;
    dismissSuggestions();
    setInputError('');
  }, [dismissSuggestions]);

  return {
    inputUrl,
    historySuggestions,
    primaryAction,
    inputError,
    highlightedSuggestionIndex,
    handleInputChange,
    handleInputFocus,
    handleInputBlur,
    handleInputKeyDown,
    setHighlightedSuggestionIndex,
    handleSuggestionClick,
    handlePrimaryActionClick,
    submitUrl,
    syncDisplayedUrl,
    resetAutocompleteState,
  };
}
