import type { ChangeEventHandler, FocusEventHandler, KeyboardEventHandler } from 'react';
import type { BrowserHistoryEntry } from '../../shared/types/browserHistory';

interface BrowserUrlInputProps {
  inputUrl: string;
  historySuggestions: BrowserHistoryEntry[];
  highlightedSuggestionIndex: number;
  onInputChange: ChangeEventHandler<HTMLInputElement>;
  onInputFocus: FocusEventHandler<HTMLInputElement>;
  onInputBlur: FocusEventHandler<HTMLInputElement>;
  onInputKeyDown: KeyboardEventHandler<HTMLInputElement>;
  onHighlightSuggestion: (index: number) => void;
  onSuggestionClick: (entry: BrowserHistoryEntry) => void;
}

export default function BrowserUrlInput({
  inputUrl,
  historySuggestions,
  highlightedSuggestionIndex,
  onInputChange,
  onInputFocus,
  onInputBlur,
  onInputKeyDown,
  onHighlightSuggestion,
  onSuggestionClick,
}: BrowserUrlInputProps) {
  return (
    <div className="browser-url-container">
      <input
        type="text"
        className="browser-url-input"
        value={inputUrl}
        onChange={onInputChange}
        onFocus={onInputFocus}
        onBlur={onInputBlur}
        onKeyDown={onInputKeyDown}
        placeholder="Enter URL..."
        aria-autocomplete="list"
        aria-expanded={historySuggestions.length > 0}
        aria-controls="browser-url-history-suggestions"
      />
      {historySuggestions.length > 0 ? (
        <div
          id="browser-url-history-suggestions"
          className="browser-history-suggestions"
          role="listbox"
          aria-label="URL history suggestions"
        >
          {historySuggestions.map((entry, index) => (
            <button
              key={`${entry.url}-${entry.lastVisited}`}
              type="button"
              className={`browser-history-suggestion ${index === highlightedSuggestionIndex ? 'highlighted' : ''}`}
              role="option"
              aria-selected={index === highlightedSuggestionIndex}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => onHighlightSuggestion(index)}
              onClick={() => onSuggestionClick(entry)}
            >
              <span className="browser-history-suggestion-url">{entry.url}</span>
              {entry.title ? <span className="browser-history-suggestion-title">{entry.title}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
