import { act, cleanup, renderHook } from '@testing-library/react';
import type { ChangeEvent, FocusEvent, KeyboardEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBrowserUrlAutocomplete } from '../../../src/renderer/components/useBrowserUrlAutocomplete';
import type { BrowserHistoryEntry } from '../../../src/shared/types/browserHistory';

const history: BrowserHistoryEntry[] = [{ url: 'http://localhost:8000/', title: 'App', lastVisited: 1 }];
const change = (value: string) => ({ target: { value } }) as ChangeEvent<HTMLInputElement>;
function key(value: string, composing = false) {
  return { key: value, nativeEvent: { isComposing: composing }, preventDefault: vi.fn() } as unknown as KeyboardEvent<HTMLInputElement>;
}

function setup() {
  const getHistory = vi.fn<(query: string) => Promise<BrowserHistoryEntry[]>>().mockResolvedValue(history);
  const onNavigate = vi.fn<(url: string) => Promise<string | null>>().mockImplementation(async url => url);
  const hook = renderHook(() => useBrowserUrlAutocomplete({ displayedUrl: '', activeTabId: 'a', getHistory, onNavigate }));
  return { ...hook, getHistory, onNavigate };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('browser autocomplete interactions', () => {
  it.each(['Enter', 'Go'])('%s submits the typed search even when matching history arrives', async method => {
    const { result, onNavigate } = setup();
    act(() => result.current.handleInputChange(change('8000')));
    await act(() => vi.advanceTimersByTimeAsync(150));
    expect(result.current.historySuggestions).toEqual(history);
    expect(result.current.highlightedSuggestionIndex).toBe(-1);
    await act(async () => {
      if (method === 'Go') await result.current.submitUrl();
      else result.current.handleInputKeyDown(key('Enter'));
    });
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('https://www.google.com/search?q=8000');
    expect(result.current.primaryAction).toBeNull();
  });

  it.each(['Enter', 'Go'])('%s opens explicitly selected history', async method => {
    const { result, onNavigate } = setup();
    act(() => result.current.handleInputChange(change('8000')));
    await act(() => vi.advanceTimersByTimeAsync(150));
    act(() => result.current.handleInputKeyDown(key('ArrowDown')));
    await act(async () => {
      if (method === 'Go') await result.current.submitUrl();
      else result.current.handleInputKeyDown(key('Enter'));
    });
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(history[0].url);
  });

  it('returns to the typed action with ArrowUp and cycles through every option', async () => {
    const { result } = setup();
    act(() => result.current.handleInputChange(change('8000')));
    await act(() => vi.advanceTimersByTimeAsync(150));
    act(() => result.current.handleInputKeyDown(key('ArrowDown')));
    expect(result.current.highlightedSuggestionIndex).toBe(0);
    act(() => result.current.handleInputKeyDown(key('ArrowUp')));
    expect(result.current.highlightedSuggestionIndex).toBe(-1);
    act(() => result.current.handleInputKeyDown(key('ArrowUp')));
    expect(result.current.highlightedSuggestionIndex).toBe(0);
  });

  it('shows recent history when the empty bar receives focus', async () => {
    const { result, getHistory } = setup();
    act(() => result.current.handleInputFocus());
    await act(() => vi.advanceTimersByTimeAsync(150));
    expect(getHistory).toHaveBeenCalledExactlyOnceWith('');
    expect(result.current.primaryAction).toBeNull();
    expect(result.current.historySuggestions).toEqual(history);
  });

  it.each(['Escape', 'blur', 'change', 'reset'])('discards a pending query after %s', async event => {
    const { result, getHistory } = setup();
    let resolve!: (entries: BrowserHistoryEntry[]) => void;
    getHistory.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    act(() => result.current.handleInputChange(change('old')));
    await act(() => vi.advanceTimersByTimeAsync(150));
    act(() => {
      if (event === 'Escape') result.current.handleInputKeyDown(key('Escape'));
      if (event === 'blur') result.current.handleInputBlur({ relatedTarget: null } as FocusEvent<HTMLInputElement>);
      if (event === 'change') result.current.handleInputChange(change('new'));
      if (event === 'reset') result.current.resetAutocompleteState();
    });
    await act(async () => resolve(history));
    expect(result.current.historySuggestions).toEqual([]);
    if (event !== 'change') expect(result.current.primaryAction).toBeNull();
  });

  it('clears the previous query immediately rather than allowing Enter to open stale history', async () => {
    const { result, onNavigate } = setup();
    act(() => result.current.handleInputChange(change('8000')));
    await act(() => vi.advanceTimersByTimeAsync(150));
    act(() => result.current.handleInputKeyDown(key('ArrowDown')));
    act(() => result.current.handleInputChange(change('new query')));
    expect(result.current.historySuggestions).toEqual([]);
    await act(() => result.current.submitUrl());
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('https://www.google.com/search?q=new%20query');
  });

  it('does not overwrite a newer edit when a navigation completes late', async () => {
    const { result, onNavigate } = setup();
    let resolve!: (url: string) => void;
    onNavigate.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    act(() => result.current.handleInputChange(change('first query')));
    let pending!: Promise<void>;
    act(() => { pending = result.current.submitUrl(); });
    act(() => result.current.handleInputChange(change('second query')));
    await act(async () => { resolve('https://www.google.com/search?q=first'); await pending; });
    expect(result.current.inputUrl).toBe('second query');
  });

  it('keeps search usable when history discovery fails', async () => {
    const { result, getHistory, onNavigate } = setup();
    getHistory.mockRejectedValue(new Error('unavailable'));
    act(() => result.current.handleInputChange(change('query')));
    await act(() => vi.advanceTimersByTimeAsync(150));
    expect(result.current.primaryAction?.kind).toBe('search');
    await act(() => result.current.submitUrl());
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('https://www.google.com/search?q=query');
  });

  it('shows an invalid-address error and never sends it to Google', async () => {
    const { result, onNavigate } = setup();
    act(() => result.current.handleInputChange(change('javascript:alert(1)')));
    await act(() => result.current.submitUrl());
    expect(onNavigate).not.toHaveBeenCalled();
    expect(result.current.inputError).toContain('valid HTTP(S)');
  });

  it('does not navigate while an IME composition is being committed', () => {
    const { result, onNavigate } = setup();
    act(() => result.current.handleInputChange(change('日本語')));
    act(() => result.current.handleInputKeyDown(key('Enter', true)));
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
