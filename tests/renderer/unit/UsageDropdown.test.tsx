import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UsageDropdown from '../../../src/renderer/components/UsageDropdown';
import type { HarnessUsageEntry, HarnessUsageMeasurementView } from '../../../src/shared/types/harnessUsage';

const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
const pct = (label: string, used: number, extra: Partial<HarnessUsageMeasurementView> = {}): HarnessUsageMeasurementView =>
  ({ kind: 'rate-limit', unit: 'percent', used, remaining: Math.max(0, 100 - used), limit: 100, label, ...extra });
const entry = (harnessId: string, overrides: Partial<HarnessUsageEntry> = {}): HarnessUsageEntry =>
  ({ harnessId, status: 'ok', measurements: [], checkedAt: NOW - 30_000, ...overrides });

const renderPanel = (entries: Record<string, HarnessUsageEntry | undefined> = {}, props: Partial<Parameters<typeof UsageDropdown>[0]> = {}) =>
  render(<UsageDropdown entries={entries} pending={{}} refreshing={false} now={NOW} canRefresh onRefresh={() => {}} {...props} />);
const section = (name: string) => screen.getByRole('region', { name });

describe('UsageDropdown', () => {
  it('lists every canonical harness from HARNESS_OPTIONS, in order, with icons and names', () => {
    const { container } = renderPanel();
    const names = [...container.querySelectorAll('.usage-harness-name')].map((node) => node.textContent);
    expect(names).toEqual(['Codex', 'Claude', 'OpenCode', 'Pi', 'Oh My Pi', 'Hermes', 'Antigravity']);
    expect(container.querySelectorAll('.usage-harness-icon img').length).toBe(7);
  });

  it('shows a per-harness checking state without hiding other rows', () => {
    renderPanel({ claude: entry('claude', { measurements: [pct('Claude · weekly', 10)] }) }, { pending: { codex: true } });
    expect(within(section('Codex')).getByText('Checking usage…')).toBeInTheDocument();
    expect(within(section('Claude')).getByText('weekly')).toBeInTheDocument();
    expect(within(section('Claude')).queryByText('Checking usage…')).not.toBeInTheDocument();
  });

  it('renders percent windows with remaining text, a used-quota progress bar, resets, plan/account and checked time', () => {
    renderPanel({ codex: entry('codex', { measurements: [
      pct('Codex · 5 hour', 28, { resetsAt: NOW + 102 * 60_000, scope: { providerId: 'openai-codex', planLabel: 'Plus', accountLabel: 'alice@example.invalid' } }),
      pct('Codex · weekly', 59, { resetsAt: NOW + (3 * 24 + 6) * 3_600_000, scope: { providerId: 'openai-codex', planLabel: 'Plus', accountLabel: 'alice@example.invalid' } }),
    ] }) });
    const codex = section('Codex');
    expect(within(codex).getByText('Plus · alice@example.invalid')).toBeInTheDocument();
    expect(within(codex).getByText('5 hour')).toBeInTheDocument();
    expect(within(codex).getByText('72% remaining')).toBeInTheDocument();
    expect(within(codex).getByText('resets in 1h 42m')).toBeInTheDocument();
    expect(within(codex).getByText('resets in 3d 6h')).toBeInTheDocument();
    expect(within(codex).getByText('checked just now')).toBeInTheDocument();
    const bar = within(codex).getByRole('progressbar', { name: 'Codex 5 hour' });
    expect(bar).toHaveAttribute('aria-valuenow', '28');
    expect(bar).toHaveAttribute('aria-valuetext', '72% remaining');
    expect(within(codex).queryByText(/Codex ·/)).not.toBeInTheDocument(); // single group: no subheader, no duplicated prefix
  });

  it('keeps over-100 usage readable and clamps only the bar', () => {
    renderPanel({ claude: entry('claude', { measurements: [pct('Claude · weekly', 130)] }) });
    expect(within(section('Claude')).getByText('130% used')).toBeInTheDocument();
    const bar = within(section('Claude')).getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '100');
    expect(bar.firstElementChild).toHaveStyle({ width: '100%' });
  });

  it('renders absolute units, with money only for USD', () => {
    renderPanel({ omp: entry('omp', { measurements: [
      { kind: 'spend', unit: 'usd', used: 4.2, limit: 20, label: 'Credits' },
      { kind: 'tokens', unit: 'tokens', remaining: 680, label: 'Tokens' },
      { kind: 'allowance', unit: 'credits', used: 3, limit: 10, label: 'Promo' },
    ] }) });
    const omp = section('Oh My Pi');
    expect(within(omp).getByText('$4.20 / $20.00 used')).toBeInTheDocument();
    expect(within(omp).getByText('680 tokens remaining')).toBeInTheDocument();
    expect(within(omp).getByText('3 / 10 credits used')).toBeInTheDocument();
    expect(within(omp).getAllByRole('progressbar')).toHaveLength(2); // none for the token row without a denominator
  });

  it('groups multiple providers/accounts inside one harness with subheaders and display names', () => {
    renderPanel({ omp: entry('omp', { measurements: [
      pct('5 hours', 10, { scope: { providerId: 'anthropic', planLabel: 'Pro', accountLabel: 'a@example.invalid' } }),
      pct('7 days', 20, { scope: { providerId: 'anthropic', planLabel: 'Pro', accountLabel: 'a@example.invalid' } }),
      pct('5 hours', 30, { scope: { providerId: 'openai-codex', planLabel: 'Plus' } }),
      pct('Credits', 40, { scope: { providerId: 'some-new_vendor' } }),
    ] }) });
    const omp = section('Oh My Pi');
    expect(within(omp).getByText('Anthropic · Pro · a@example.invalid')).toBeInTheDocument();
    expect(within(omp).getByText('OpenAI Codex · Plus')).toBeInTheDocument();
    expect(within(omp).getByText('Some New Vendor')).toBeInTheDocument();
    expect(omp.querySelector('.usage-harness-meta')).toBeNull(); // multi-group: no single header meta
  });

  it('keeps provider-supplied labels intact for other harnesses', () => {
    renderPanel({ agy: entry('agy', { measurements: [pct('Gemini Models · Weekly Limit Remaining', 17, { scope: { providerId: 'google-antigravity' } })] }) });
    expect(within(section('Antigravity')).getByText('Gemini Models · Weekly Limit Remaining')).toBeInTheDocument();
  });

  it('distinguishes an empty successful result from an unsupported probe', () => {
    renderPanel({ hermes: entry('hermes'), pi: entry('pi', { status: 'unsupported', error: 'No supported usage probe', checkedAt: undefined, measurements: [] }) });
    expect(within(section('Hermes')).getByText('No active usage limits reported')).toBeInTheDocument();
    expect(within(section('Pi')).getByText('No supported usage probe')).toBeInTheDocument();
    expect(within(section('Pi')).queryByText(/checked/)).not.toBeInTheDocument();
  });

  it.each([
    ['unsupported', 'No supported usage probe', 'muted'], ['not-installed', 'Not installed in this environment', 'muted'],
    ['unauthenticated', 'Not signed in', 'warning'], ['unavailable', 'Usage temporarily unavailable', 'warning'], ['error', 'Usage could not be read', 'error'],
  ] as const)('shows the %s state with its tone', (status, text, tone) => {
    renderPanel({ opencode: entry('opencode', { status, error: text }) });
    const note = within(section('OpenCode')).getByText(text);
    expect(note).toHaveClass(`usage-status-${tone}`);
  });
  it('falls back to default status copy when the entry carries no text', () => {
    renderPanel({ opencode: entry('opencode', { status: 'unauthenticated' }) });
    expect(within(section('OpenCode')).getByText('Not signed in')).toBeInTheDocument();
  });

  it('keeps stale last-good measurements visible, marks them Stale and shows the current failure', () => {
    renderPanel({ claude: entry('claude', { status: 'unavailable', stale: true, error: 'Usage temporarily unavailable', measurements: [pct('Claude · 5 hour', 69)] }) });
    const claude = section('Claude');
    expect(within(claude).getByText('Stale')).toBeInTheDocument();
    expect(within(claude).getByText('31% remaining')).toBeInTheDocument();
    expect(within(claude).getByText('Usage temporarily unavailable')).toBeInTheDocument();
  });

  it('truncates long account labels visually but exposes the full text', () => {
    const long = `${'very-long-account-name'.repeat(5)}@example.invalid`;
    renderPanel({ codex: entry('codex', { measurements: [pct('Codex · 5 hour', 1, { scope: { accountLabel: long, planLabel: 'Plus' } })] }) });
    const meta = section('Codex').querySelector('.usage-harness-meta')!;
    expect(meta).toHaveAttribute('title', `Plus · ${long}`);
  });

  it('refresh control: accessible name, busy state, disabled with a countdown title', async () => {
    const onRefresh = vi.fn();
    const { rerender } = render(<UsageDropdown entries={{}} pending={{}} refreshing={false} now={NOW} canRefresh onRefresh={onRefresh} />);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh usage' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    rerender(<UsageDropdown entries={{}} pending={{}} refreshing now={NOW} canRefresh={false} onRefresh={onRefresh} />);
    expect(screen.getByRole('button', { name: 'Refresh usage' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh usage' })).toHaveAttribute('title', 'Refreshing usage…');
    rerender(<UsageDropdown entries={{}} pending={{}} refreshing={false} now={NOW} canRefresh={false} nextManualRefreshAt={NOW + 32_000} onRefresh={onRefresh} />);
    expect(screen.getByRole('button', { name: 'Refresh usage' })).toHaveAttribute('title', 'Refresh available in 32s');
  });
});
