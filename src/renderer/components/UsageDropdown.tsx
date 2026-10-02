import { RefreshCw } from 'lucide-react';
import type { HarnessUsageEntry, HarnessUsageStatus } from '../../shared/types/harnessUsage';
import { HARNESS_OPTIONS } from '../lib/harnessOptions';
import { describeMeasurement, formatChecked, formatReset, groupMeasurements, groupMeta, providerDisplayName } from '../lib/usageFormat';
import './UsageDropdown.css';

interface Props {
  /** Usage-capable, enabled harnesses to render, in canonical order. */
  harnessIds: readonly string[];
  entries: Record<string, HarnessUsageEntry | undefined>;
  otherAccounts?: Record<string, HarnessUsageEntry[] | undefined>;
  onSelectAccount?: (harnessId: string, accountId: string) => void;
  pending: Record<string, boolean>;
  refreshing: boolean;
  now: number;
  canRefresh: boolean;
  nextManualRefreshAt?: number;
  onRefresh: () => void;
}

const STATUS_TEXT: Record<Exclude<HarnessUsageStatus, 'ok'>, string> = {
  unsupported: 'No supported usage probe',
  'not-installed': 'Not installed in this environment',
  unauthenticated: 'Not signed in',
  unavailable: 'Usage temporarily unavailable',
  error: 'Usage could not be read',
};
const STATUS_TONE: Record<HarnessUsageStatus, string> = {
  ok: 'ok', unsupported: 'muted', 'not-installed': 'muted', unauthenticated: 'warning', unavailable: 'warning', error: 'error',
};

function refreshTitle(refreshing: boolean, canRefresh: boolean, nextAt: number | undefined, now: number): string {
  if (refreshing) return 'Refreshing usage…';
  if (!canRefresh && nextAt !== undefined) return `Refresh available in ${Math.max(1, Math.ceil((nextAt - now) / 1000))}s`;
  return 'Refresh usage';
}

export default function UsageDropdown({ harnessIds, entries, otherAccounts, onSelectAccount, pending, refreshing, now, canRefresh, nextManualRefreshAt, onRefresh }: Props) {
  const title = refreshTitle(refreshing, canRefresh, nextManualRefreshAt, now);
  return (
    <div className="usage-dropdown">
      <div className="usage-header">
        <span className="usage-title">Usage</span>
        <button type="button" className="usage-refresh" onClick={onRefresh} disabled={!canRefresh} aria-label="Refresh usage" title={title}>
          <RefreshCw size={12} strokeWidth={2} className={refreshing ? 'usage-spin' : undefined} />
        </button>
      </div>
      {harnessIds.length === 0 && (
        <div className="usage-harness">
          <p className="usage-note">No usage providers selected</p>
          <p className="usage-checked">Enable providers in Settings → Harness Defaults.</p>
        </div>
      )}
      {harnessIds.map((id) => {
        const option = HARNESS_OPTIONS.find((candidate) => candidate.id === id)!;
        const primary = entries[id];
        return (
          <div key={id}>
            <HarnessSection label={option.label} Icon={option.Icon} entry={primary} checking={pending[id] === true} now={now} />
            {(otherAccounts?.[id] ?? []).map((other) => (
              <HarnessSection
                key={other.account?.id ?? 'other'} label={option.label} Icon={option.Icon} entry={other} checking={false} now={now}
                onUse={other.account && onSelectAccount ? () => onSelectAccount(id, other.account!.id) : undefined}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function HarnessSection({ label, Icon, entry, checking, now, onUse }: {
  label: string; Icon: (typeof HARNESS_OPTIONS)[number]['Icon']; entry?: HarnessUsageEntry; checking: boolean; now: number; onUse?: () => void;
}) {
  const groups = entry ? groupMeasurements(entry.measurements) : [];
  const single = groups.length === 1 ? groups[0] : undefined;
  const meta = single ? groupMeta(single) : '';
  const stale = entry?.stale === true && (entry?.measurements.length ?? 0) > 0;
  const statusText = entry && entry.status !== 'ok' ? (entry.error ?? STATUS_TEXT[entry.status]) : undefined;
  return (
    <section className="usage-harness" aria-label={label} aria-busy={checking}>
      <div className="usage-harness-header">
        <span className="usage-harness-icon"><Icon size={12} strokeWidth={2.5} /></span>
        <span className="usage-harness-name">{label}{entry?.account ? ` · ${entry.account.name}` : ''}</span>
        {entry?.account?.selected && <span className="usage-badge">In use</span>}
        {onUse && <button type="button" className="usage-badge usage-use" onClick={onUse} aria-label={`Use ${entry?.account?.name ?? 'account'} for ${label}`}>Use</button>}
        {meta && <span className="usage-harness-meta" title={meta}>{meta}</span>}
        {stale && <span className="usage-badge">Stale</span>}
      </div>
      {!entry && checking && <p className="usage-note" role="status">Checking usage…</p>}
      {entry && entry.status === 'ok' && entry.measurements.length === 0 && <p className="usage-note">No active usage limits reported</p>}
      {groups.map((group) => (
        <div key={group.key} className="usage-group">
          {groups.length > 1 && (
            <div className="usage-group-header" title={[group.providerId && providerDisplayName(group.providerId), groupMeta(group)].filter(Boolean).join(' · ')}>
              {[group.providerId && providerDisplayName(group.providerId), groupMeta(group)].filter(Boolean).join(' · ') || 'Account'}
            </div>
          )}
          {group.measurements.map((measurement, index) => {
            const view = describeMeasurement(measurement, label);
            return (
              <div key={`${view.label}-${index}`} className="usage-measurement">
                <div className="usage-measurement-line">
                  <span className="usage-measurement-label" title={view.label}>{view.label}</span>
                  <span className="usage-measurement-value">{view.value}</span>
                </div>
                {view.ratio !== undefined && (
                  <div className={`usage-bar ${view.ratio <= 0.1 ? 'low' : ''}`} role="progressbar" aria-label={`${label} ${view.label}`}
                    aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.percentNow} aria-valuetext={view.value}>
                    <div className="usage-bar-fill" style={{ width: `${view.ratio * 100}%` }} />
                  </div>
                )}
                {view.resetsAt !== undefined && <div className="usage-reset">{formatReset(view.resetsAt, now)}</div>}
              </div>
            );
          })}
        </div>
      ))}
      {statusText && <p className={`usage-note usage-status usage-status-${STATUS_TONE[entry!.status]}`}>{statusText}</p>}
      {entry?.checkedAt !== undefined && <div className="usage-checked">{formatChecked(entry.checkedAt, now)}</div>}
    </section>
  );
}
