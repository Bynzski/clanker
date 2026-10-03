import { IconButton } from '../ui/IconButton';
import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { HarnessOption } from '../../lib/harnessOptions';
import type { ModelOption } from '../../types/shared';
import type { HarnessDefaultsMap } from '../../../shared/types/store';
import { MAX_GATE_TERMINALS } from '../../lib/workspaceLaunchPlan';
import { ModelSearchPicker } from '../ModelSearchPicker';

interface Props {
  options: HarnessOption[];
  counts: Record<string, number>;
  models: Record<string, ModelOption[]>;
  modelsLoading: boolean;
  selectedModels: Record<string, string>;
  defaults: HarnessDefaultsMap | null;
  remote: boolean;
  disabled: boolean;
  refreshing: boolean;
  onInteract: (harness: string) => void;
  onCount: (harness: string, count: number) => void;
  onModel: (harness: string, model: string) => void;
  onFavorite: (harness: string, model: string) => void | Promise<void>;
  onRefresh: () => void;
}

function HarnessRow({ option, total, ...props }: Props & { option: HarnessOption; total: number }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const count = props.counts[option.id] ?? 0;
  const models = props.models[option.id] ?? [];
  // A remote picker is offered only for a real catalog from that host; favorites never add models it lacks.
  const remoteCatalog = props.remote && models.length > 0;
  const favorites = (props.defaults?.[option.id]?.favorites ?? []).filter((id) => !props.remote || models.some((m) => m.id === id));
  const model = props.selectedModels[option.id] ?? '';
  return <div className={`gate-harness-row ${count ? 'has-terminals' : ''}`} data-harness-id={option.id}
    onFocusCapture={() => { if (!props.disabled) props.onInteract(option.id); }}
    onPointerDownCapture={() => { if (!props.disabled) props.onInteract(option.id); }}>
    <div className="gate-harness-name"><option.Icon size={16} /><span>{option.label}</span></div>
    <div className="gate-harness-model">
      {option.id && (!props.remote || remoteCatalog) && <ModelSearchPicker harness={option.id} model={model} models={models}
        includeDefault={props.remote} pinDefaultFirst={props.remote}
        favorites={favorites} savedHermesModel={props.defaults?.hermes?.model ?? ''}
        refreshing={props.refreshing} loading={props.modelsLoading} open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(id) => props.onModel(option.id, id)} onToggleFavorite={(id) => props.onFavorite(option.id, id)}
        onRefreshHermes={props.onRefresh} isUnresolved={(id) => !!id && option.id !== 'hermes' && !models.some((m) => m.id === id)} />}
      {option.id && props.remote && !remoteCatalog && <span className="gate-host-model" title="Uses the model configured on this server">Host default</span>}
    </div>
    <div className="gate-harness-count" role="group" aria-label={`${option.label} terminals`}>
      <IconButton type="button" aria-label={`Remove ${option.label} terminal`} disabled={props.disabled || count === 0} onClick={() => props.onCount(option.id, count - 1)}><Minus size={12} /></IconButton>
      <output aria-label={`${option.label} terminal count`}>{count}</output>
      <IconButton type="button" aria-label={`Add ${option.label} terminal`} disabled={props.disabled || total >= MAX_GATE_TERMINALS} onClick={() => props.onCount(option.id, count + 1)}><Plus size={12} /></IconButton>
    </div>
  </div>;
}

export function HarnessLaunchList(props: Props) {
  const total = props.options.reduce((sum, option) => sum + (props.counts[option.id] ?? 0), 0);
  return <section className="gate-harness-list" aria-label="Terminal launch plan">
    <fieldset disabled={props.disabled} className="gate-harness-rows">
      {props.options.map((option) => <HarnessRow key={option.id} {...props} option={option} total={total} />)}
    </fieldset>
  </section>;
}
