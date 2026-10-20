import { useEffect, useId, useRef } from 'react';
import { Clock, Globe, Search } from 'lucide-react';
import { Input } from './ui/Input';
import type { ChangeEventHandler, FocusEventHandler, KeyboardEventHandler, Ref } from 'react';
import type { BrowserHistorySuggestion } from '../../shared/types/browserHistory';
import type { BrowserAddressAction } from '../lib/browserAddress';

interface BrowserUrlInputProps {
  inputRef?: Ref<HTMLInputElement>;
  inputUrl: string;
  primaryAction: Exclude<BrowserAddressAction, { kind: 'invalid' }> | null;
  inputError: string;
  historySuggestions: BrowserHistorySuggestion[];
  highlightedSuggestionIndex: number;
  onInputChange: ChangeEventHandler<HTMLInputElement>;
  onInputFocus: FocusEventHandler<HTMLInputElement>;
  onInputBlur: FocusEventHandler<HTMLInputElement>;
  onInputKeyDown: KeyboardEventHandler<HTMLInputElement>;
  onHighlightSuggestion: (index: number) => void;
  onSuggestionClick: (entry: BrowserHistorySuggestion) => void;
  onPrimaryActionClick: () => void;
}

function MatchedText({ text, query }: { text: string; query: string }) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const lower = text.toLowerCase();
  const ranges: Array<{ start: number; end: number }> = [];
  for (const token of tokens) {
    let start = lower.indexOf(token);
    while (start >= 0) {
      ranges.push({ start, end: start + token.length });
      start = lower.indexOf(token, start + token.length);
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  const merged: typeof ranges = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  let cursor = 0;
  const parts = merged.map(range => {
    const before = text.slice(cursor, range.start);
    cursor = range.end;
    return <span key={range.start}>{before}<mark>{text.slice(range.start, range.end)}</mark></span>;
  });
  return <>{parts}{text.slice(cursor)}</>;

}

export default function BrowserUrlInput({
  inputRef, inputUrl, primaryAction, inputError, historySuggestions, highlightedSuggestionIndex,
  onInputChange, onInputFocus, onInputBlur, onInputKeyDown, onHighlightSuggestion,
  onSuggestionClick, onPrimaryActionClick,
}: BrowserUrlInputProps) {
  const id = useId();
  const listId = `${id}-suggestions`;
  const listRef = useRef<HTMLDivElement>(null);
  const expanded = Boolean(primaryAction || historySuggestions.length);
  const selectedId = highlightedSuggestionIndex >= 0 && historySuggestions[highlightedSuggestionIndex]
    ? `${id}-${highlightedSuggestionIndex}` : primaryAction ? `${id}-primary` : undefined;

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [highlightedSuggestionIndex]);

  return (
    <div className="browser-url-container">
      <Input variant="mono"
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label="Search Google or enter address"
        className="browser-url-input"
        value={inputUrl}
        onChange={onInputChange}
        onFocus={onInputFocus}
        onBlur={onInputBlur}
        onKeyDown={onInputKeyDown}
        placeholder="Search Google or enter address…"
        autoComplete="off"
        spellCheck={false}
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        aria-activedescendant={expanded ? selectedId : undefined}
        aria-invalid={Boolean(inputError)}
        aria-describedby={inputError ? `${id}-error` : undefined}
      />
      {inputError ? <div id={`${id}-error`} className="browser-history-suggestions browser-address-error" role="alert">{inputError}</div> : null}
      {expanded ? (
        <div id={listId} ref={listRef} className="browser-history-suggestions" role="listbox" aria-label="Browser suggestions">
          {primaryAction ? (
            <button id={`${id}-primary`} type="button" tabIndex={-1}
              className={`browser-history-suggestion ${highlightedSuggestionIndex === -1 ? 'highlighted' : ''}`}
              role="option" aria-selected={highlightedSuggestionIndex === -1}
              onMouseDown={event => event.preventDefault()}
              onMouseEnter={() => onHighlightSuggestion(-1)} onClick={onPrimaryActionClick}>
              {primaryAction.kind === 'search' ? <Search size={15} aria-hidden="true" /> : <Globe size={15} aria-hidden="true" />}
              <span className="browser-suggestion-text"><span className="browser-history-suggestion-title">{primaryAction.label}</span></span>
            </button>
          ) : null}
          {historySuggestions.length ? <div className="browser-suggestion-heading" aria-hidden="true">{inputUrl.trim() ? 'From history' : 'Recent history'}</div> : null}
          {historySuggestions.map((entry, index) => (
            <button id={`${id}-${index}`} key={entry.url} type="button" tabIndex={-1}
              className={`browser-history-suggestion ${index === highlightedSuggestionIndex ? 'highlighted' : ''}`}
              role="option" aria-label={[entry.source === 'site' ? 'Website' : '', entry.title, entry.url].filter(Boolean).join(' ')} aria-selected={index === highlightedSuggestionIndex}
              onMouseDown={event => event.preventDefault()}
              onMouseEnter={() => onHighlightSuggestion(index)} onClick={() => onSuggestionClick(entry)}>
              {entry.source === 'site' ? <Globe size={15} aria-hidden="true" /> : <Clock size={15} aria-hidden="true" />}
              <span className="browser-suggestion-text">
                {entry.title ? <span className="browser-history-suggestion-title"><MatchedText text={entry.title} query={inputUrl} /></span> : null}
                <span className="browser-history-suggestion-url"><MatchedText text={entry.url} query={inputUrl} /></span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
