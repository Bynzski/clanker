import type { AssistantActivity, AssistantCapability, AssistantProfileDetails, AssistantRead, AssistantRoutine, AssistantRun } from '../../shared/types/assistantDetails';
import { HERMES_LOOPBACK_HOST, type FetchLike } from './hermesBackend';
import { RpcError } from './hermesTransport';

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
/** Display text only. Strip control sequences, URLs, common credential assignments and home paths. */
export function displayText(value: unknown, limit = 160): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.slice(0, 8192).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/https?:\/\/\S+|(?:\/home\/|\/Users\/|[A-Z]:\\Users\\)\S+/gi, '[redacted]')
    .replace(/\b(api[_-]?key|token|password|secret|authorization)\s*[:=]\s*\S+/gi, '$1=[redacted]').trim().slice(0, limit) || undefined;
}
function epoch(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1e11 ? value : undefined;
}
export function parseActivity(value: unknown): AssistantActivity {
  const row = record(value); const last = record(row.last_session);
  return { model: displayText(row.model), provider: displayText(row.provider),
    skillCount: Number.isInteger(row.skill_count) && (row.skill_count as number) >= 0 ? Math.min(row.skill_count as number, 100000) : undefined,
    ...(row.last_session ? { lastSession: { title: displayText(last.title), lastActive: epoch(last.last_active) } } : {}),
    workerLastActive: epoch(record(row.worker_session).last_active) };
}
function capabilities(value: unknown): AssistantCapability[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.length > 512) throw new Error('Too many capabilities');
  return value.flatMap((raw) => { const row = record(raw); const name = displayText(row.name, 80);
    return name ? [{ name, enabled: typeof row.enabled === 'boolean' ? row.enabled : undefined }] : []; });
}
export function parseProfile(value: unknown, slug: string): AssistantProfileDetails {
  const row = record(value);
  if (row.name !== slug) throw new Error('Unexpected profile');
  const model = record(row.model);
  return { model: displayText(model.default), provider: displayText(model.provider), skills: capabilities(row.skills),
    toolsets: capabilities(row.toolsets), mcpServers: capabilities(row.mcp_servers) };
}
export function parseHistory(value: unknown): { title?: string; lastActive?: number }[] {
  const rows = record(value).sessions;
  if (!Array.isArray(rows) || rows.length > 20) throw new Error('Unexpected history');
  return rows.flatMap((raw) => { const row = record(raw);
    // Worker sources and hidden/canonical chats are not ordinary history. Unknown sources fail closed.
    if (row.hidden === true || row.title === 'Bot Chat' || row.root_title === 'Bot Chat' || !['cli', 'tui', 'desktop', 'web', 'api'].includes(String(row.source))) return [];
    return [{ title: displayText(row.title), lastActive: epoch(row.last_active) }]; });
}
export const JOB_ID = /^[A-Za-z0-9_-]{1,128}$/;
export function parseRoutines(value: unknown, slug: string): AssistantRoutine[] {
  if (!Array.isArray(value) || value.length > 128) throw new Error('Unexpected jobs');
  const seen = new Set<string>();
  return value.map((raw) => {
    const row = record(raw);
    if (row.profile !== slug || typeof row.id !== 'string' || row.id === 'unknown' || !JOB_ID.test(row.id) || seen.has(row.id)) throw new Error('Unconfirmed job ownership');
    seen.add(row.id);
    // Hermes synthesizes unnamed job labels from prompts/scripts. Do not expose those excerpts.
    const derivedName = [row.prompt, row.script, row.skill, Array.isArray(row.skills) ? row.skills[0] : undefined].some((value) => typeof value === 'string' && row.name === value.slice(0, 50).trim());
    const safe = (value: unknown) => {
      let text = typeof value === 'string' ? value : '';
      for (const path of [row.hermes_home, row.workdir, row.script]) if (typeof path === 'string' && path) text = text.split(path).join('[redacted]');
      return displayText(text);
    };
    const kind = record(row.schedule).kind;
    const attempts = record(row.repeat).completed;
    const latest = record(row.latest_execution);
    const latestStatus = latest.status;
    if (row.latest_execution != null && latest.job_id !== row.id) throw new Error('Unconfirmed attempt ownership');
    const results: Record<string, string> = { ok: 'Succeeded', error: 'Failed', interrupted: 'Interrupted', delivery_failed: 'Delivery failed', blocked_config: 'Configuration blocked', skipped: 'Skipped' };
    return { id: row.id, name: derivedName ? 'Scheduled task' : safe(row.name) ?? 'Scheduled task', enabled: typeof row.enabled === 'boolean' ? row.enabled : undefined,
      state: ['scheduled', 'paused', 'completed', 'error'].includes(String(row.state)) ? String(row.state) : 'Unknown', schedule: safe(row.schedule_display), timezone: safe(row.timezone),
      scheduleKind: kind === 'once' || kind === 'interval' || kind === 'cron' ? kind : undefined,
      nextRun: safe(row.next_run_at), lastRun: safe(row.last_run_at), nextRunAbsent: row.next_run_at === null, lastRunAbsent: row.last_run_at === null,
      recordedRuns: typeof attempts === 'number' && Number.isSafeInteger(attempts) && attempts >= 0 ? attempts : undefined,
      lastResult: row.last_status === null ? 'No result recorded' : Object.prototype.hasOwnProperty.call(results, String(row.last_status)) ? results[String(row.last_status)] : 'Unknown',
      ...(latest.job_id === row.id && ['claimed', 'running', 'completed', 'failed', 'unknown'].includes(String(latestStatus)) ? {
        latestAttempt: { status: latestStatus as NonNullable<AssistantRoutine['latestAttempt']>['status'], claimedAt: safe(latest.claimed_at), finishedAt: safe(latest.finished_at) },
      } : {}),
    };
  });
}
export function parseRuns(value: unknown, slug: string, jobId: string): AssistantRun[] {
  if (!JOB_ID.test(jobId)) throw new Error('Invalid job id');
  const seen = new Set<string>();
  const rows = record(value).runs;
  if (!Array.isArray(rows) || rows.length > 20) throw new Error('Unexpected runs');
  return rows.map((raw) => {
    const row = record(raw);
    // Before/after job-list checks cannot close the native wrong-profile fallback race.
    // Unscoped output records are therefore unavailable, even if their id has the right prefix.
    if (row.profile !== slug) throw new UnconfirmedRunOwnership();
    if (typeof row.id !== 'string' ||
      !(row.source === 'cron_output' && row.id.startsWith(`cron_output:${jobId}:`) || row.source === 'cron' && new RegExp(`^cron_${jobId}_[0-9]{8}_[0-9]{6}$`).test(row.id))) throw new Error('Unexpected run ownership');
    if (seen.has(row.id)) throw new Error('Duplicate run');
    seen.add(row.id);
    return { startedAt: epoch(row.started_at), endedAt: epoch(row.ended_at), source: row.source as 'cron' | 'cron_output' };
  });
}
export async function readSection<T>(read: () => Promise<T>): Promise<AssistantRead<T>> {
  try { return { state: 'ready', data: await read() }; }
  catch (error) { if (error instanceof UnconfirmedRunOwnership) return { state: 'unavailable' }; return { state: error instanceof RpcError && error.code === -32601 || error instanceof UnsupportedRead ? 'unsupported' : 'error' }; }
}
class UnsupportedRead extends Error {}
class UnconfirmedRunOwnership extends Error {}
/** Fixed loopback REST routes only. No redirects, bounded streamed body, hard timeout, token stays in main. */
export async function readHermesRest(fetcher: FetchLike, endpoint: { port: number; token: string; host?: '127.0.0.1' | '[::1]' }, path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetcher(`http://${endpoint.host ?? HERMES_LOOPBACK_HOST}:${endpoint.port}${path}`, {
    headers: { 'X-Hermes-Session-Token': endpoint.token }, signal, redirect: 'error',
  });
  if (response.status === 404 || response.status === 405 || response.status === 501) throw new UnsupportedRead();
  if (!response.ok) throw new Error('Read failed');
  let text = '';
  if (response.body) {
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let bytes = 0;
    try { while (true) { const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength; if (bytes > 1024 * 1024) throw new Error('Response too large');
      text += decoder.decode(chunk.value, { stream: true });
    } text += decoder.decode(); } finally { await reader.cancel(); }
  } else { text = await response.text(); if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('Response too large'); }
  return JSON.parse(text);
}
