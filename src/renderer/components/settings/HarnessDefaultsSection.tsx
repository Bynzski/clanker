import { useState } from 'react';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { Input } from '../ui/Input';
import { Field, FieldLabel } from '../ui/Field';
import { ModelSearchPicker } from '../ModelSearchPicker';
import { HARNESS_OPTIONS } from '../../lib/harnessOptions';
import { HARNESS_FLAGS_PLACEHOLDER } from '../../lib/harnessFlags';
import { HARNESS_DESCRIPTORS } from '../../../shared/harnessDescriptors';
import type { HarnessDefaultsMap } from '../../../shared/types/store';
import type { ModelOption } from '../../types/shared';

interface HarnessDefaultsSectionProps {
  harnessDefaults: HarnessDefaultsMap;
  availableHarnessIds: string[];
  expandedHarness: string | null;
  setExpandedHarness: (id: string | null) => void;
  harnessModelCache: Record<string, ModelOption[]>;
  harnessModelLoading: Record<string, boolean>;
  harnessModelError?: Record<string, string>;
  loadHarnessModels: (id: string, refresh?: boolean) => Promise<void>;
  handleSetHarnessFlags: (id: string, flags: string) => Promise<void>;
  handleSetHarnessVisible: (id: string, visible: boolean) => Promise<void>;
  handleSetHarnessAttention: (id: string, enabled: boolean) => Promise<void>;
  handleSetHarnessUsageVisible: (id: string, enabled: boolean) => Promise<void>;
  handleSetHarnessAgentBridge?: (id: string, enabled: boolean) => Promise<void>;
  handleSetDefaultModel: (id: string, model: string) => Promise<void>;
  handleToggleFavorite: (id: string, model: string) => Promise<void>;
  environmentId?: string;
  onManageAccounts?: (id: string) => void;
}

/** One selector/detail view, with no account controller mounted here. */
export default function HarnessDefaultsSection(props: HarnessDefaultsSectionProps) {
  const options = HARNESS_OPTIONS.filter((option) => option.id && props.availableHarnessIds.includes(option.id));
  const selected = options.find((option) => option.id === props.expandedHarness);
  return <div className="settings-harnesses">
    <div className="settings-harness-selector" role="group" aria-label="Available harnesses">
      {options.map((option) => <Button key={option.id} size="sm" variant={selected?.id === option.id ? 'secondary' : 'ghost'}
        aria-pressed={selected?.id === option.id} onClick={() => {
          props.setExpandedHarness(option.id);
          if (HARNESS_DESCRIPTORS[option.id as keyof typeof HARNESS_DESCRIPTORS].modelSelection !== 'text') void props.loadHarnessModels(option.id);
        }}><option.Icon size={14} aria-hidden="true" />{option.label}</Button>)}
    </div>
    {selected ? <HarnessDetail key={`${props.environmentId ?? 'local'}:${selected.id}`} {...props} harnessId={selected.id} label={selected.label} /> :
      <p className="management-page-description">{options.length ? (props.expandedHarness ? 'The selected harness is unavailable in this environment. Select an available harness.' : 'Select a harness to configure its defaults.') : 'No harnesses available in this environment.'}</p>}
  </div>;
}

function HarnessDetail({ harnessId, label, environmentId = 'local', ...props }: HarnessDefaultsSectionProps & { harnessId: string; label: string }) {
  const descriptor = HARNESS_DESCRIPTORS[harnessId as keyof typeof HARNESS_DESCRIPTORS];
  const defaults = props.harnessDefaults[harnessId];
  const models = props.harnessModelCache[harnessId] ?? [];
  const loading = props.harnessModelLoading[harnessId] ?? false;
  const current = defaults?.model ?? '';
  const remote = environmentId !== 'local';
  const custom = descriptor.modelSelection === 'catalog-or-custom';
  const [manual, setManual] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const visible = defaults?.visible !== false;
  const attentionSupported = remote ? descriptor.attention.remote : descriptor.attention.local;
  return <section className="settings-harness-detail" aria-label={`${label} preferences`}>
    <h3 className="management-page-title">{label}</h3>
    <p className="management-page-description">Available · Defaults apply to future launches.</p>
    <Checkbox checked={visible} aria-label={`${visible ? 'Hide' : 'Show'} ${label}`}
      onChange={(event) => void props.handleSetHarnessVisible(harnessId, event.target.checked)}>Show in toolbar and launcher</Checkbox>
    <Checkbox checked={defaults?.attentionEnabled === true} disabled={!attentionSupported} aria-label={`Agent attention for ${label}`}
      onChange={(event) => void props.handleSetHarnessAttention(harnessId, event.target.checked)}>Agent attention</Checkbox>
    {!attentionSupported && <p className="management-page-description">Attention is unavailable here; this preference applies only to supported environments.</p>}
    {'agentBridge' in descriptor && props.handleSetHarnessAgentBridge && <>
      <Checkbox checked={defaults?.agentBridgeEnabled === true} disabled={remote} aria-label={`Clanker bridge for ${label}`}
        onChange={(event) => void props.handleSetHarnessAgentBridge?.(harnessId, event.target.checked)}>Clanker bridge (MCP)</Checkbox>
      <p className="management-page-description">Local launches only. Your own MCP configuration is not changed.</p>
    </>}
    {'usage' in descriptor && <Checkbox checked={defaults?.usageVisible !== false} aria-label={`Show ${label} in Usage`}
      onChange={(event) => void props.handleSetHarnessUsageVisible(harnessId, event.target.checked)}>Show in Usage</Checkbox>}
    <Field>
      <FieldLabel htmlFor={`flags-${harnessId}`}>Extra flags</FieldLabel>
      <Input id={`flags-${harnessId}`} value={defaults?.flags ?? ''} placeholder={HARNESS_FLAGS_PLACEHOLDER[harnessId] ?? ''}
        onChange={(event) => void props.handleSetHarnessFlags(harnessId, event.target.value)} />
    </Field>
    <div className="settings-field">
      <span className="settings-row-label">Default model</span>
      {descriptor.modelSelection === 'text' || (custom && (manual || models.length === 0)) ?
        <Input autoFocus={manual} aria-label={manual ? `${label} custom model` : `${label} default model`} value={manual && custom && models.some((entry) => entry.id === current) ? '' : current}
          onChange={(event) => void props.handleSetDefaultModel(harnessId, event.target.value)} placeholder="Use harness default" /> :
        <ModelSearchPicker harness={harnessId} model={current} models={models} favorites={defaults?.favorites ?? []}
          savedHermesModel={current} loading={loading} refreshing={loading} disabled={loading} fullWidth includeDefault
          triggerLabel={`${label} default model`} open={pickerOpen} onOpenChange={setPickerOpen}
          onSelect={(model) => void props.handleSetDefaultModel(harnessId, model)}
          onToggleFavorite={(model) => props.handleToggleFavorite(harnessId, model)}
          onRefreshHermes={() => { setPickerOpen(false); void props.loadHarnessModels(harnessId, true); }}
          onEnterCustom={custom ? () => setManual(true) : undefined}
          isUnresolved={(model) => !custom && !!model && !models.some((entry) => entry.id === model)} />}
      {!remote && descriptor.modelSelection !== 'text' && props.harnessModelCache[harnessId] === undefined && !loading &&
        <Button onClick={() => void props.loadHarnessModels(harnessId)}>Load models</Button>}
      {remote && <p className="management-page-description">Remote model catalogs are not loaded here. Saved selections and favorites remain available.</p>}
      {custom && manual && <Button onClick={() => setManual(false)}>Browse Hermes models</Button>}
      {custom && !remote && (manual || models.length === 0) && <Button disabled={loading} onClick={() => void props.loadHarnessModels(harnessId, true)}>{loading ? 'Refreshing Hermes models…' : 'Refresh Hermes models'}</Button>}
      {props.harnessModelError?.[harnessId] && <p role="alert">{props.harnessModelError[harnessId]} <Button onClick={() => void props.loadHarnessModels(harnessId, true)}>Retry models</Button></p>}
    </div>
    {'accounts' in descriptor && props.onManageAccounts && <Button onClick={() => props.onManageAccounts?.(harnessId)}>Manage {label} accounts</Button>}
  </section>;
}
