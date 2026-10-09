import type { HarnessUsageEntry, HarnessUsageMeasurementView, HarnessUsageStatus } from '../../shared/types/harnessUsage';

/** Presentation-only helpers for the Usage panel. Nothing here influences capability, caching or correlation. */

const STATUS_TEXT: Record<Exclude<HarnessUsageStatus, 'ok' | 'not-installed'>, string> = {
  unsupported: 'No supported usage probe',
  unauthenticated: 'Not signed in',
  unavailable: 'Usage temporarily unavailable',
  error: 'Usage could not be read',
};

/** Shared panel/chip status: scheduled expiry alone never marks a measurement stale. */
export function usageProblem(entry: HarnessUsageEntry | undefined): string {
  const stale = entry?.stale === true && entry.measurements.length > 0;
  const status = entry && entry.status !== 'ok' && entry.status !== 'not-installed'
    ? entry.error ?? STATUS_TEXT[entry.status] : undefined;
  return [stale ? 'Stale usage data' : undefined, status].filter(Boolean).join(' · ');
}

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  'openai-codex': 'OpenAI Codex',
  'google-antigravity': 'Google Antigravity',
  openrouter: 'OpenRouter',
};

/** Known display names; unknown machine ids get a conservative humanized fallback. */
export function providerDisplayName(providerId: string): string {
  const known = PROVIDER_NAMES[providerId.toLowerCase()];
  if (known) return known;
  return providerId
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

const numberFormat = (value: number, maxFraction: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: maxFraction }).format(value);
const formatPercent = (value: number) => numberFormat(value, Math.abs(value) < 10 ? 1 : 0);
const formatAmount = (value: number) => numberFormat(value, Math.abs(value) < 100 ? 2 : 0);
const formatUsd = (value: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(value);

export interface MeasurementDisplay {
  label: string;
  /** Right-aligned value text, e.g. "72% remaining". */
  value: string;
  /** Fill ratio of REMAINING capacity (full = nothing used), clamped to 0..1; undefined without a meaningful denominator. */
  ratio?: number;
  /** Remaining percentage for aria-valuenow, clamped to 0..100 (the text itself is never clamped). */
  percentNow?: number;
  resetsAt?: number;
}

/** Strip only an exact leading "<harness label> · " from that harness's own measurement labels. */
export function measurementLabel(measurement: HarnessUsageMeasurementView, harnessLabel: string): string {
  const prefix = `${harnessLabel} · `;
  const raw = measurement.label?.startsWith(prefix) ? measurement.label.slice(prefix.length) : measurement.label;
  return raw?.trim() || measurement.period?.label || measurement.scope?.modelId || measurement.kind;
}

export function describeMeasurement(measurement: HarnessUsageMeasurementView, harnessLabel: string): MeasurementDisplay {
  const label = measurementLabel(measurement, harnessLabel);
  const { unit, used, remaining, limit } = measurement;
  const base = { label, resetsAt: measurement.resetsAt };

  if (unit.toLowerCase() === 'percent') {
    const value = used !== undefined && used > 100 ? `${formatPercent(used)}% used`
      : remaining !== undefined ? `${formatPercent(remaining)}% remaining`
      : used !== undefined ? `${formatPercent(used)}% used` : 'No data';
    const remainingPercent = remaining ?? (used !== undefined ? 100 - used : undefined);
    const ratio = remainingPercent === undefined ? undefined : Math.min(1, Math.max(0, remainingPercent / 100));
    return { ...base, value, ratio, percentNow: ratio === undefined ? undefined : Math.round(ratio * 100) };
  }

  const money = unit.toLowerCase() === 'usd';
  const fmt = (n: number) => (money ? formatUsd(n) : formatAmount(n));
  const suffix = money ? '' : ` ${unit}`;
  const usedAmount = used ?? (limit !== undefined && remaining !== undefined ? Math.max(0, limit - remaining) : undefined);
  let value: string;
  if (usedAmount !== undefined && limit !== undefined) value = `${fmt(usedAmount)} / ${fmt(limit)}${suffix} used`;
  else if (remaining !== undefined) value = `${fmt(remaining)}${suffix} remaining`;
  else if (usedAmount !== undefined) value = `${fmt(usedAmount)}${suffix} used`;
  else if (limit !== undefined) value = `${fmt(limit)}${suffix} limit`;
  else value = 'No data';
  const remainingAmount = remaining ?? (limit !== undefined && used !== undefined ? limit - used : undefined);
  const ratio = remainingAmount !== undefined && limit !== undefined && limit > 0 ? Math.min(1, Math.max(0, remainingAmount / limit)) : undefined;
  return { ...base, value, ratio, percentNow: ratio === undefined ? undefined : Math.round(ratio * 100) };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "resets in 1h 42m", "resets in 3d 6h", "resets Oct 18", or "reset due". No seconds. */
export function formatReset(resetsAt: number, now: number): string {
  const delta = resetsAt - now;
  if (delta <= 0) return 'reset due';
  if (delta < HOUR) return `resets in ${Math.max(1, Math.ceil(delta / MINUTE))}m`;
  if (delta < DAY) {
    const hours = Math.floor(delta / HOUR);
    const minutes = Math.floor((delta % HOUR) / MINUTE);
    return minutes ? `resets in ${hours}h ${minutes}m` : `resets in ${hours}h`;
  }
  if (delta < 10 * DAY) {
    const days = Math.floor(delta / DAY);
    const hours = Math.floor((delta % DAY) / HOUR);
    return hours ? `resets in ${days}d ${hours}h` : `resets in ${days}d`;
  }
  return `resets ${new Date(resetsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

export function formatChecked(checkedAt: number, now: number): string {
  const minutes = Math.max(0, now - checkedAt) / MINUTE;
  if (minutes < 2) return 'checked just now';
  if (minutes < 60) return `checked ${Math.floor(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `checked ${Math.floor(hours)}h ago`;
  return `checked ${new Date(checkedAt).toLocaleDateString()}`;
}

export interface MeasurementGroup {
  key: string;
  providerId?: string;
  planLabel?: string;
  accountLabel?: string;
  measurements: HarnessUsageMeasurementView[];
}

/** Group by display-safe scope identity (provider, account, plan); the model stays on the measurement. */
export function groupMeasurements(measurements: HarnessUsageMeasurementView[]): MeasurementGroup[] {
  const groups = new Map<string, MeasurementGroup>();
  for (const measurement of measurements) {
    const { providerId, planLabel, accountLabel } = measurement.scope ?? {};
    const key = JSON.stringify([providerId ?? '', accountLabel ?? '', planLabel ?? '']);
    let group = groups.get(key);
    if (!group) groups.set(key, group = { key, providerId, planLabel, accountLabel, measurements: [] });
    group.measurements.push(measurement);
  }
  return [...groups.values()];
}

export const groupMeta = (group: MeasurementGroup): string => [group.planLabel, group.accountLabel].filter(Boolean).join(' · ');

/** Coarse countdown for the status-bar widget: "35m", "3h", "5d". Never finer than the unit shown. */
export function formatResetShort(resetsAt: number, now: number): string {
  const delta = resetsAt - now;
  if (delta <= 0) return 'now';
  if (delta < HOUR) return `${Math.max(1, Math.ceil(delta / MINUTE))}m`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`;
  return `${Math.floor(delta / DAY)}d`;
}

export interface WidgetUsage {
  /** Remaining capacity, 0..1. */
  ratio: number;
  percent: number;
  label: string;
  resetsAt?: number;
}

/** The five-hour limit when there is one, else the weekly one; undefined if neither reports a ratio. */
export function pickWidgetUsage(measurements: HarnessUsageMeasurementView[], harnessLabel: string): WidgetUsage | undefined {
  const described = measurements.map((measurement) => describeMeasurement(measurement, harnessLabel))
    .filter((view): view is MeasurementDisplay & { ratio: number; percentNow: number } => view.ratio !== undefined && view.percentNow !== undefined);
  const view = described.find((entry) => /(5|five)[\s-]?h(ou)?r/i.test(entry.label))
    ?? described.find((entry) => /week/i.test(entry.label));
  return view && { ratio: view.ratio, percent: view.percentNow, label: view.label, resetsAt: view.resetsAt };
}

/** Green above half, yellow down to a fifth, red below. */
export const usageTone = (ratio: number): 'ok' | 'warn' | 'low' => (ratio > 0.5 ? 'ok' : ratio > 0.2 ? 'warn' : 'low');
