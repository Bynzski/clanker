import { useEffect, useMemo, useRef, useState } from 'react';
import { Clock3, Gauge } from 'lucide-react';
import { USAGE_HARNESS_IDS } from '../../shared/harnessDescriptors';
import type { HarnessDefaultsMap } from '../../shared/types/store';
import { selectFocusedWorkspace, useWorkspaceStore } from '../store/workspaceStore';
import { useUsageWidgetStore } from '../store/usageWidgetStore';
import { resolveDestinationCapabilities, useActiveDestination } from '../lib/activeDestination';
import { HARNESS_OPTIONS, resolveAvailableHarnessIds } from '../lib/harnessOptions';
import { onUsagePreferenceSaved, openAccountSettings } from '../lib/settingsHandoff';
import { formatResetShort, pickWidgetUsage, usageTone } from '../lib/usageFormat';
import { Popover, PopoverContent, PopoverTrigger } from './ui/Popover';
import UsageDropdown from './UsageDropdown';
import { useHarnessUsage } from './useHarnessUsage';
import './UsageDropdown.css';

/** Status-bar Usage control: the dial, plus a compact chip for each harness pinned from the panel. */
export default function UsageWidget() {
  const focusedWorkspace = useWorkspaceStore((state) => selectFocusedWorkspace(state));
  const destination = useActiveDestination();
  const capabilities = resolveDestinationCapabilities(destination);
  const pinned = useUsageWidgetStore((state) => state.ids);
  const togglePin = useUsageWidgetStore((state) => state.toggle);
  const [open, setOpen] = useState(false);
  const handoff = useRef(false);
  // A destination change closes the popover (reset during render).
  const destinationKey = destination.kind === 'workspace'
    ? destination.workspaceId
    : destination.kind === 'assistant'
    ? destination.assistantId
    : 'none';
  const [owner, setOwner] = useState(destinationKey);
  if (owner !== destinationKey) { setOwner(destinationKey); setOpen(false); }

  // Effective environment: Assistant and none are always local; workspace uses its environment.
  const environmentId = destination.kind === 'assistant' || destination.kind === 'none'
    ? 'local'
    : (focusedWorkspace?.environmentId || 'local');
  const workspaceId = destination.kind === 'workspace' ? (focusedWorkspace?.id ?? null) : null;
  // Background reads are local-only: they must never trigger unattended SSH probes.
  const local = environmentId === 'local';

  // Installed harnesses and the "Show in Usage" preference; usage is fail-closed until both have loaded.
  const [available, setAvailable] = useState<{ environmentId: string; ids: string[] } | null>(null);
  const [defaults, setDefaults] = useState<HarnessDefaultsMap | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const options = environmentId === 'local' ? await window.electronAPI.getHarnessOptions() : await window.electronAPI.getEnvironmentHarnessOptions(environmentId);
        if (!cancelled) setAvailable({ environmentId, ids: resolveAvailableHarnessIds(options) });
      } catch { if (!cancelled) setAvailable(null); }
    })();
    return () => { cancelled = true; };
  }, [environmentId]);
  const [defaultsEpoch, setDefaultsEpoch] = useState(0);
  useEffect(() => onUsagePreferenceSaved(() => setDefaultsEpoch((value) => value + 1)), []);
  useEffect(() => {
    let cancelled = false;
    window.electronAPI.getHarnessDefaults().then((value) => { if (!cancelled) setDefaults(value); }).catch(() => { if (!cancelled) setDefaults(null); });
    return () => { cancelled = true; };
  }, [defaultsEpoch]);

  const usageIds = useMemo(() => !defaults || available?.environmentId !== environmentId ? [] : HARNESS_OPTIONS.map((option) => option.id).filter((id) =>
    (USAGE_HARNESS_IDS as readonly string[]).includes(id) && available.ids.includes(id) && defaults[id]?.usageVisible !== false), [available, defaults, environmentId]);
  const chipIds = useMemo(() => usageIds.filter((id) => pinned.includes(id)), [usageIds, pinned]);
  const shouldPoll = capabilities.usage && (open || (local && chipIds.length > 0));
  const shouldPrefetch = capabilities.usage && local;
  const usage = useHarnessUsage({
    workspaceId,
    open: shouldPoll,
    harnessIds: usageIds,
    environmentId,
    prefetch: shouldPrefetch,
  });

  if (!capabilities.usage) return null;
  const chips = chipIds.flatMap((id) => {
    const entry = usage.entries[id];
    const option = HARNESS_OPTIONS.find((candidate) => candidate.id === id)!;
    const picked = entry && pickWidgetUsage(entry.measurements, option.label);
    if (!picked) return [];
    const description = `${option.label} ${picked.label}: ${picked.percent}% left${picked.resetsAt !== undefined ? `, resets in ${formatResetShort(picked.resetsAt, usage.now)}` : ''}`;
    return [{ id, option, picked, description }];
  });
  const summary = chips.map(({ description }) => description).join('\n');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={`usage-widget${open ? ' active' : ''}`} aria-label="Usage" title={summary || 'Usage'} disabled={!defaults && !open}>
          <Gauge size={12} strokeWidth={2} aria-hidden="true" />
          {chips.map(({ id, option, picked, description }) => (
            <span key={id} className={`usage-chip ${usageTone(picked.ratio)}`} role="group" aria-label={description} title={description}>
              <option.Icon size={11} strokeWidth={2} />
              <span className="usage-chip-meter">
                <span className="usage-chip-percent">{picked.percent}%</span>
                <span className="usage-chip-bar" aria-hidden="true"><span className="usage-chip-fill" style={{ width: `${picked.percent}%` }} /></span>
              </span>
              {picked.resetsAt !== undefined && <span className="usage-chip-time"><Clock3 size={8} aria-hidden="true" />{formatResetShort(picked.resetsAt, usage.now)}</span>}
            </span>
          ))}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="usage-popover" aria-label="Usage" workspaceId={workspaceId ?? undefined}
        onCloseAutoFocus={(event) => {
          // On a Usage -> Settings handoff, restoring focus here would dismiss the Settings popover that is opening.
          if (handoff.current) { event.preventDefault(); handoff.current = false; }
        }}>
        <UsageDropdown
          harnessIds={usage.harnessIds}
          entries={usage.entries}
          otherAccounts={usage.otherAccounts}
          onSelectAccount={usage.selectAccount}
          onManageAccounts={(harnessId, intent) => { handoff.current = true; setOpen(false); if (!openAccountSettings(harnessId, intent)) handoff.current = false; }}
          widgetIds={pinned}
          onToggleWidget={togglePin}
          pending={usage.pending}
          refreshing={usage.refreshing}
          now={usage.now}
          canRefresh={usage.canManualRefresh}
          nextManualRefreshAt={usage.nextManualRefreshAt}
          onRefresh={() => usage.refreshAll(true)}
        />
      </PopoverContent>
    </Popover>
  );
}
