import { useRef, useState } from 'react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/Popover';
import { searchSettings, type SettingsSearchResult } from './settingsSearch';
import './SettingsSearch.css';

export default function SettingsSearch({ assistantsAvailable, disabled, onSelect }: {
  assistantsAvailable: boolean; disabled: boolean; onSelect: (result: SettingsSearchResult) => void;
}) {
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const results = searchSettings(query, assistantsAvailable);
  const handingOff = useRef(false);
  const select = (result: SettingsSearchResult) => { handingOff.current = true; setQuery(''); onSelect(result); };
  const clear = () => { setQuery(''); input.current?.focus(); };
  return <div className="settings-search"><Popover open={!!query.trim()} onOpenChange={(open) => { if (!open) setQuery(''); }}>
    <PopoverTrigger asChild><Input ref={input} type="search" role="searchbox" aria-label="Search Settings" placeholder="Search settings" value={query} disabled={disabled}
      onClick={(event) => event.preventDefault()} onChange={(event) => setQuery(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); clear(); }
        if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && results.length) { event.preventDefault(); buttons.current.get(results[event.key === 'ArrowDown' ? 0 : results.length - 1].id)?.focus(); }
        if (event.key === 'Enter' && results.length) { event.preventDefault(); select(results[0]); }
      }} /></PopoverTrigger>
    {query.trim() && <PopoverContent className="settings-search-results" align="end" aria-label="Settings search results"
      onOpenAutoFocus={(event) => { event.preventDefault(); input.current?.focus(); }}
      onCloseAutoFocus={(event) => { if (handingOff.current) { event.preventDefault(); handingOff.current = false; } }}>
      <div role="group" aria-label="Search results">
      {!results.length && <p role="status">No matching settings</p>}
      {results.map((result, index) => <Button key={result.id} variant="ghost" disabled={disabled}
        ref={(element) => { if (element) buttons.current.set(result.id, element); else buttons.current.delete(result.id); }}
        onClick={() => select(result)} onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); clear(); }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
            const button = buttons.current.get(results[next].id); button?.focus(); button?.scrollIntoView?.({ block: 'nearest' });
          }
        }}>{result.label}</Button>)}
    </div></PopoverContent>}
  </Popover></div>;
}
