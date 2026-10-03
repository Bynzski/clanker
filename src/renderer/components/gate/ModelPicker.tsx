import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { AlertTriangle, Check, ChevronDown, Search, Star, X } from 'lucide-react';
import type { ModelOption } from '../../types/shared';
import { hermesModelDisplay, hermesModelLabel } from '../../lib/hermesModelDisplay';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/Popover';
import { Dialog, DialogContent, DialogTitle, DialogClose } from '../ui/Dialog';
import { ModelSearchPicker } from '../ModelSearchPicker';
import { IconButton } from '../ui/IconButton';

interface ModelPickerProps {
  fullscreen?: boolean;
  compact?: boolean;
  harness: string;
  model: string;
  models: ModelOption[];
  sortedModels: ModelOption[];
  favorites: string[];
  savedHermesModel: string;
  refreshing: boolean;
  loading?: boolean;
  favoritesOpen: boolean;
  discoveryOpen: boolean;
  onFavoritesOpenChange: (open: boolean) => void;
  onDiscoveryOpenChange: (open: boolean) => void;
  onSelect: (model: string) => void;
  onToggleFavorite: (model: string) => void | Promise<void>;
  onRefreshHermes: () => void;
  isUnresolved: (model: string) => boolean;
}

function HermesModelName({ option }: { option: ModelOption }) {
  const { model, provider } = hermesModelDisplay(option);
  return <span className="hermes-model-name" title={hermesModelLabel(option)}>
    <span className="hermes-model-id">{model}</span>
    {provider && <span className="hermes-model-provider">{provider}</span>}
  </span>;
}

/** Model data and persistence stay in the Gate; only search and focus are local. */
function LegacyModelPicker({ fullscreen = false, harness, model, models, sortedModels, favorites, savedHermesModel, refreshing,
  favoritesOpen, discoveryOpen, onFavoritesOpenChange, onDiscoveryOpenChange, onSelect, onToggleFavorite,
  onRefreshHermes, isUnresolved }: ModelPickerProps) {
  const [search, setSearch] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const choicesRef = useRef(new Map<string, HTMLButtonElement>());
  const handingOff = useRef(false);
  const resultsId = useId();
  const warningId = useId();
  const browseRef = useRef<HTMLButtonElement>(null);
  const favoriteChoicesRef = useRef(new Map<string, HTMLButtonElement>());
  const selectedOption = models.find((option) => option.id === model);
  const hermes = harness === 'hermes';
  const matches = useMemo(() => sortedModels.filter((option) =>
    option.label.toLowerCase().includes(search.toLowerCase()) || option.id.toLowerCase().includes(search.toLowerCase())
  ), [sortedModels, search]);

  const label = (option: ModelOption) => hermes ? <HermesModelName option={option} /> : option.label;
  const name = (option: ModelOption) => hermes ? hermesModelLabel(option) : option.label;
  const select = (id: string, discovery: boolean) => {
    onSelect(id);
    if (discovery) onDiscoveryOpenChange(false);
    else onFavoritesOpenChange(false);
  };
  const focusChoice = (index: number) => {
    const option = matches[index];
    const button = option && choicesRef.current.get(option.id);
    button?.focus();
    button?.scrollIntoView?.({ block: 'nearest' });
  };
  // Search + native action buttons: arrows move actual focus, Enter stays native,
  // and star actions remain separate Tab stops (no interactive listbox children).
  const navigate = (event: KeyboardEvent, index?: number) => {
    if (!matches.length || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    event.preventDefault();
    const next = index === undefined
      ? event.key === 'ArrowDown' ? 0 : matches.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
    focusChoice(next);
  };
  const refreshLabel = refreshing ? 'Refreshing…' : 'Refresh Hermes models';

  return <div className="model-picker">
    <span className="gate-section-label">Model</span>
    <span id={warningId} hidden>Model is unavailable</span>
    {hermes && !models.length && <Button type="button" className="gate-model-refresh" disabled={refreshing} onClick={onRefreshHermes}>{refreshLabel}</Button>}
    {hermes && !models.length ? <Input type="text" className="settings-select" aria-label="Hermes model" placeholder="Use Hermes default"
      value={model} onChange={(event) => onSelect(event.target.value)} /> : <>
      <Popover open={favoritesOpen} onOpenChange={onFavoritesOpenChange}>
        <PopoverTrigger asChild>
          <button ref={triggerRef} type="button" className={`model-pill ${hermes ? 'hermes-model-pill' : ''}`} title="Change model" aria-label="Change model" aria-describedby={isUnresolved(model) ? warningId : undefined}>
            <span className={`model-pill-label ${hermes ? 'hermes-model-label' : ''} ${isUnresolved(model) ? 'unresolved' : ''}`}>
              {hermes && selectedOption ? label(selectedOption) : model ? selectedOption?.label ?? model : 'Default model'}
            </span>
            {isUnresolved(model) && <AlertTriangle size={12} className="model-pill-warning" aria-label="Model unavailable" />}
            <ChevronDown size={12} strokeWidth={2.5} className="model-pill-caret" />
          </button>
        </PopoverTrigger>
        <PopoverContent className={`favorites-picker ${fullscreen ? 'start-gate-favorites' : ''}`} aria-label="Favorite models" align="start"
          onCloseAutoFocus={(event) => { if (handingOff.current) event.preventDefault(); }}>
          {!favorites.length ? <div className="favorites-empty"><span className="favorites-empty-text">
            {hermes && selectedOption ? label(selectedOption) : model ? selectedOption?.label ?? 'Default model' : 'No default set'}
          </span></div> : favorites.map((id) => {
            const option = models.find((item) => item.id === id);
            const accessibleName = option ? name(option) : id;
            return <div key={id} className={`favorites-item ${model === id ? 'selected' : ''} ${isUnresolved(id) ? 'unresolved' : ''}`}>
              <button type="button" className="model-choice" aria-pressed={model === id} aria-describedby={isUnresolved(id) ? warningId : undefined}
                ref={(button) => { if (button) favoriteChoicesRef.current.set(id, button); else favoriteChoicesRef.current.delete(id); }} onClick={() => select(id, false)}>
                <span className={`favorites-model-label ${hermes ? 'hermes-favorite-label' : ''}`}>
                  {option ? label(option) : id}
                  {isUnresolved(id) && <AlertTriangle size={10} className="favorites-unresolved-icon" aria-label="Model unavailable" />}
                </span>
                {model === id && <Check size={12} strokeWidth={2.5} className="favorites-check" />}
              </button>
              <IconButton variant="ghost" type="button" className="favorites-star-btn favorited" title="Remove from favorites"
                aria-label={`Remove ${accessibleName} from favorites`} onClick={() => {
                  onToggleFavorite(id);
                  // The removed star may unmount after persistence; keep focus in the surface.
                  const next = favorites.find((favorite) => favorite !== id);
                  (next ? favoriteChoicesRef.current.get(next) : browseRef.current)?.focus();
                }}>
                <Star size={12} fill="currentColor" />
              </IconButton>
            </div>;
          })}
          {hermes && <Button type="button" className="favorites-browse-link" onClick={() => select(savedHermesModel, false)}>
            {savedHermesModel ? 'Use saved default' : 'Use Hermes default'}
          </Button>}
          <Button ref={browseRef} type="button" className="favorites-browse-link" onClick={() => {
            // Prevent the outgoing Popover from refocusing its trigger over the new Dialog.
            handingOff.current = true;
            setSearch('');
            onFavoritesOpenChange(false);
            onDiscoveryOpenChange(true);
          }}>Browse all models</Button>
        </PopoverContent>
      </Popover>
      {hermes && <Input type="text" className="settings-select" aria-label="Hermes model" placeholder="Enter custom model"
        value={models.some((option) => option.id === model) ? '' : model} onChange={(event) => onSelect(event.target.value)} />}
      <Dialog open={discoveryOpen} onOpenChange={onDiscoveryOpenChange}>
        <DialogContent className="discovery-modal" aria-describedby={undefined}
          onOpenAutoFocus={(event) => { event.preventDefault(); searchRef.current?.focus(); }}
          onCloseAutoFocus={(event) => {
            handingOff.current = false;
            if (triggerRef.current?.isConnected) { event.preventDefault(); triggerRef.current.focus(); }
          }}>
          <div className="discovery-header clanker-dialog-header">
            <DialogTitle asChild><span className="discovery-title clanker-dialog-title">All Models</span></DialogTitle>
            {hermes && <Button type="button" className="discovery-refresh" onClick={onRefreshHermes} disabled={refreshing}>{refreshLabel}</Button>}
            <DialogClose asChild><IconButton variant="ghost" className="discovery-close clanker-dialog-close" aria-label="Close All Models" title="Close"><X size={14} /></IconButton></DialogClose>
          </div>
          <div className="discovery-search-wrap">
            <Search size={14} className="discovery-search-icon" />
            <Input ref={searchRef} type="text" role="searchbox" aria-label="Search models" aria-controls={resultsId}
              className="discovery-search-input" placeholder="Search models…" value={search}
              onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => navigate(event)} />
          </div>
          <div id={resultsId} className="discovery-list" role="group" aria-label="Matching models">
            {!matches.length ? <div className="discovery-empty" role="status">No models found</div> : matches.map((option, index) => {
              const favorite = favorites.includes(option.id);
              return <div key={option.id} className={`discovery-item ${model === option.id ? 'selected' : ''}`}>
                <button type="button" className="model-choice" aria-pressed={model === option.id}
                  ref={(button) => { if (button) choicesRef.current.set(option.id, button); else choicesRef.current.delete(option.id); }}
                  onKeyDown={(event) => navigate(event, index)} onClick={() => select(option.id, true)}>
                  <span className={`discovery-model-label ${hermes ? 'hermes-model-label' : ''}`}>{label(option)}</span>
                  {model === option.id && <Check size={12} strokeWidth={2.5} className="discovery-check" />}
                </button>
                <IconButton variant="ghost" type="button" className={`discovery-star-btn ${favorite ? 'favorited' : ''}`}
                  title={favorite ? 'Remove from favorites' : 'Add to favorites'}
                  aria-label={`${favorite ? 'Remove' : 'Add'} ${name(option)} ${favorite ? 'from' : 'to'} favorites`}
                  onClick={() => onToggleFavorite(option.id)}><Star size={12} fill={favorite ? 'currentColor' : 'none'} /></IconButton>
              </div>;
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>}
  </div>;
}


/** Fullscreen harness rows share one searchable surface; other Gate views retain their layout. */
export function ModelPicker(props: ModelPickerProps) {
  if (!props.compact) return <LegacyModelPicker {...props} />;
  return <ModelSearchPicker {...props} open={props.favoritesOpen} onOpenChange={props.onFavoritesOpenChange} />;
}
