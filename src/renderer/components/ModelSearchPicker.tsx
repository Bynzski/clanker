import { useEffect } from 'react';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import { Button } from './ui/Button';
import { SearchablePicker, type SearchablePickerItem } from './ui/SearchablePicker';
import type { ModelOption } from '../types/shared';
import { hermesModelDisplay, hermesModelLabel } from '../lib/hermesModelDisplay';
import './ModelSearchPicker.css';

interface ModelSearchPickerProps {
  harness: string;
  model: string;
  models: ModelOption[];
  favorites: string[];
  savedHermesModel: string;
  refreshing: boolean;
  loading?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (model: string) => void;
  onToggleFavorite: (model: string) => void | Promise<void>;
  onRefreshHermes: () => void;
  isUnresolved: (model: string) => boolean;
  /** Settings use full labels and an explicit harness-default choice. */
  fullWidth?: boolean;
  includeDefault?: boolean;
  /** List the default entry first regardless of sorting (remote launch: default is the safe choice). */
  pinDefaultFirst?: boolean;
  disabled?: boolean;
  triggerLabel?: string;
  triggerId?: string;
  onEnterCustom?: () => void;
}

// The compact row needs the model name; menus and launch values retain provider identity.
function selectedModelName(option: ModelOption): string {
  const { model } = hermesModelDisplay(option);
  return model.slice(model.lastIndexOf('/') + 1) || model;
}

/** Shared model presentation; callers own discovery and persistence. */
export function ModelSearchPicker(props: ModelSearchPickerProps) {
  const { disabled, open, onOpenChange } = props;
  useEffect(() => {
    if (disabled && open) onOpenChange(false);
  }, [disabled, open, onOpenChange]);
  const selectedOption = props.models.find((option) => option.id === props.model);
  const hermes = props.harness === 'hermes';
  const items: SearchablePickerItem[] = props.models.map((option) => ({
    id: option.id, label: hermes ? hermesModelLabel(option) : option.label,
    unavailable: props.isUnresolved(option.id),
  }));
  if (props.includeDefault) items.push({ id: '', label: 'Use harness default', canFavorite: false, ...(props.pinDefaultFirst ? { pinnedFirst: true } : {}) });
  const missingIds = new Set([...props.favorites, ...(props.model ? [props.model] : [])]);
  for (const id of missingIds) {
    if (!items.some((item) => item.id === id)) items.push({ id,
      label: hermes ? hermesModelLabel({ id, label: id }) : id, unavailable: props.isUnresolved(id),
    });
  }
  const fullLabel = selectedOption ? hermes ? hermesModelLabel(selectedOption) : selectedOption.label : props.model;
  const defaultLabel = props.includeDefault ? 'Use harness default' : 'Harness default';
  const triggerLabel = props.model
    ? props.fullWidth ? fullLabel : selectedModelName(selectedOption ?? { id: props.model, label: props.model })
    : props.includeDefault && props.loading ? 'Discovering models…' : defaultLabel;
  const unresolved = props.isUnresolved(props.model);
  return <div className={`model-picker ${props.fullWidth ? 'model-picker-field' : ''}`}>
    <SearchablePicker label="Models" items={items} value={props.model} favorites={props.favorites}
      open={props.open && !props.disabled} onOpenChange={props.onOpenChange} onSelect={props.onSelect}
      onToggleFavorite={props.onToggleFavorite} emptyText={props.refreshing || props.loading ? 'Discovering models…' : 'No models found'}
      trigger={<button id={props.triggerId} type="button" className="model-pill" disabled={props.disabled} title={fullLabel || defaultLabel} aria-label={props.triggerLabel ?? `${props.harness} model`}>
        <span className={`model-pill-label ${unresolved ? 'unresolved' : ''}`}>
          {triggerLabel}
        </span>
        {unresolved && <AlertTriangle size={12} className={props.fullWidth ? 'model-pill-warning' : undefined} aria-label="Model unavailable" />}
        <ChevronDown size={12} className="model-pill-caret" aria-hidden="true" />
      </button>}
      footer={hermes ? <>
        {!props.includeDefault && <Button type="button" className="favorites-browse-link" onClick={() => { props.onSelect(props.savedHermesModel); props.onOpenChange(false); }}>
          {props.savedHermesModel ? 'Use saved default' : 'Use Hermes default'}
        </Button>}
        <Button type="button" className="favorites-browse-link" disabled={props.refreshing} onClick={props.onRefreshHermes}>
          {props.refreshing ? 'Refreshing…' : 'Refresh Hermes models'}
        </Button>
        {props.onEnterCustom && <Button type="button" className="favorites-browse-link" onClick={() => { props.onOpenChange(false); props.onEnterCustom?.(); }}>
          Enter custom model
        </Button>}
      </> : undefined} />
  </div>;
}
