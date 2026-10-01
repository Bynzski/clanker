import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactElement, ReactNode } from 'react';
import { AlertTriangle, Check, Search, Star } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';
import './SearchablePicker.css';

export interface SearchablePickerItem {
  id: string;
  label: string;
  searchText?: string;
  unavailable?: boolean;
}

interface Props {
  label: string;
  trigger: ReactElement;
  items: SearchablePickerItem[];
  value: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
  favorites?: string[];
  onToggleFavorite?: (id: string) => void | Promise<void>;
  footer?: ReactNode;
  emptyText?: string;
}

/** Search plus native selection/action buttons; no interactive children inside listbox options. */
export function SearchablePicker({ label, trigger, items, value, open, onOpenChange, onSelect,
  favorites = [], onToggleFavorite, footer, emptyText = 'No matches found' }: Props) {
  const [search, setSearch] = useState('');
  const [savingFavorite, setSavingFavorite] = useState(false);
  const [favoriteError, setFavoriteError] = useState('');
  const savingRef = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const choices = useRef(new Map<string, HTMLButtonElement>());
  const stars = useRef(new Map<string, HTMLButtonElement>());
  const restoreStar = useRef<string | null>(null);
  const resultsId = useId();
  const matches = useMemo(() => {
    const starred = new Set(favorites);
    const query = search.trim().toLowerCase();
    return items.filter((item) => `${item.label} ${item.id} ${item.searchText ?? ''}`.toLowerCase().includes(query))
      .sort((a, b) => Number(starred.has(b.id)) - Number(starred.has(a.id))
        || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  }, [items, favorites, search]);

  useEffect(() => {
    if (!savingFavorite && restoreStar.current) {
      (stars.current.get(restoreStar.current) ?? searchRef.current)?.focus();
      restoreStar.current = null;
    }
  }, [favorites, savingFavorite]);

  const select = (id: string) => { onSelect(id); onOpenChange(false); };
  const navigate = (event: KeyboardEvent, index?: number) => {
    if (!matches.length) return;
    if (index === undefined && event.key === 'Enter') {
      event.preventDefault();
      select(matches[0].id);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const next = index === undefined ? event.key === 'ArrowDown' ? 0 : matches.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
    const button = choices.current.get(matches[next].id);
    button?.focus();
    button?.scrollIntoView?.({ block: 'nearest' });
  };
  const toggleFavorite = async (id: string) => {
    if (savingRef.current || !onToggleFavorite) return;
    savingRef.current = true;
    setSavingFavorite(true);
    setFavoriteError('');
    restoreStar.current = id;
    try { await onToggleFavorite(id); }
    catch { setFavoriteError('Could not save favorite. Try again.'); restoreStar.current = null; }
    finally { savingRef.current = false; setSavingFavorite(false); }
  };

  return <Popover open={open} onOpenChange={(next) => {
    if (next) { setSearch(''); setFavoriteError(''); }
    onOpenChange(next);
  }}>
    <PopoverTrigger asChild>{trigger}</PopoverTrigger>
    <PopoverContent className="clanker-searchable-picker" aria-label={label} align="start"
      onOpenAutoFocus={(event) => { event.preventDefault(); searchRef.current?.focus(); }}>
      <div className="searchable-picker-search">
        <Search size={14} aria-hidden="true" />
        <input ref={searchRef} type="text" role="searchbox" aria-label={`Search ${label.toLowerCase()}`} aria-controls={resultsId}
          placeholder={`Search ${label.toLowerCase()}…`} value={search} onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => navigate(event)} />
      </div>
      <div id={resultsId} className="searchable-picker-results" role="group" aria-label={label}>
        {!matches.length && <div className="searchable-picker-empty" role="status">{emptyText}</div>}
        {matches.map((item, index) => {
          const favorite = favorites.includes(item.id);
          return <div key={item.id} className="searchable-picker-row" data-selected={value === item.id}>
            <button type="button" className="searchable-picker-choice" aria-pressed={value === item.id} title={item.label}
              ref={(button) => { if (button) choices.current.set(item.id, button); else choices.current.delete(item.id); }}
              onKeyDown={(event) => navigate(event, index)} onClick={() => select(item.id)}>
              <span className="searchable-picker-label">{item.label}</span>
              {item.unavailable && <AlertTriangle size={12} aria-label="Unavailable" />}
              {value === item.id && <Check size={12} aria-hidden="true" />}
            </button>
            {onToggleFavorite && <button type="button" className="searchable-picker-star" aria-pressed={favorite}
              aria-label={`${favorite ? 'Remove' : 'Add'} ${item.label} ${favorite ? 'from' : 'to'} favorites`}
              disabled={savingFavorite} ref={(button) => { if (button) stars.current.set(item.id, button); else stars.current.delete(item.id); }}
              onClick={() => { void toggleFavorite(item.id); }}><Star size={12} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" /></button>}
          </div>;
        })}
      </div>
      {favoriteError && <p className="searchable-picker-error" role="alert">{favoriteError}</p>}
      {footer && <div className="searchable-picker-footer">{footer}</div>}
    </PopoverContent>
  </Popover>;
}
