import type { AssistantActivity, AssistantCapability, AssistantProfileDetails, AssistantRead, AssistantRoutine, AssistantRun } from '../../shared/types/assistantDetails';
import { HERMES_LOOPBACK_HOST, type FetchLike } from './hermesBackend';
import { RpcError } from './hermesTransport';

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
/** Display text only. Strip control sequences, URLs, common credential assignments and home paths. */
export function displayText(value: unknown, limit = 160, redactions: readonly string[] = []): string | undefined {
  if (typeof value !== 'string') return undefined;
  let text = value.slice(0, 8192);
  for (const secret of redactions) if (secret) text = text.split(secret).join('[redacted]');
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/https?:\/\/\S+|(?:\/home\/|\/Users\/|[A-Z]:\\Users\\)\S+/gi, '[redacted]')
    .replace(/\b(api[_-]?key|token|password|secret|authorization)\s*[:=]\s*\S+/gi, '$1=[redacted]').trim().slice(0, limit) || undefined;
}
function epoch(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1e11 ? value : undefined;
}
export function parseActivity(value: unknown, redactions: readonly string[] = []): AssistantActivity {
  const row = record(value); const last = record(row.last_session);
  return { model: displayText(row.model, 160, redactions), provider: displayText(row.provider, 160, redactions),
    skillCount: Number.isInteger(row.skill_count) && (row.skill_count as number) >= 0 ? Math.min(row.skill_count as number, 100000) : undefined,
    ...(row.last_session ? { lastSession: { title: displayText(last.title, 160, redactions), lastActive: epoch(last.last_active) } } : {}),
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
    if (row.profile !== slug || typeof row.id !== 'string' || !JOB_ID.test(row.id) || seen.has(row.id)) throw new Error('Unconfirmed job ownership');
    seen.add(row.id);
    return { id: row.id, name: displayText(row.name) ?? 'Scheduled task', enabled: typeof row.enabled === 'boolean' ? row.enabled : undefined,
      state: displayText(row.state), schedule: displayText(row.schedule_display), timezone: displayText(row.timezone),
      nextRun: displayText(row.next_run_at), lastRun: displayText(row.last_run_at), lastResult: displayText(row.last_status) };
  });
}
export function parseRuns(value: unknown, slug: string, jobId: string): AssistantRun[] {
  const rows = record(value).runs;
  if (!Array.isArray(rows) || rows.length > 20) throw new Error('Unexpected runs');
  return rows.map((raw) => {
    const row = record(raw);
    if ((row.profile !== undefined && row.profile !== slug) || typeof row.id !== 'string' ||
      !(row.source === 'cron_output' && row.id.startsWith(`cron_output:${jobId}:`) || row.source === 'cron' && row.id.startsWith(`cron_${jobId}_`))) throw new Error('Unexpected run ownership');
    return { title: displayText(row.title), startedAt: epoch(row.started_at), endedAt: epoch(row.ended_at),
      source: row.source as 'cron' | 'cron_output', preview: displayText(row.preview, 1000) };
  });
}
export async function readSection<T>(read: () => Promise<T>): Promise<AssistantRead<T>> {
  try { return { state: 'ready', data: await read() }; }
  catch (error) { return { state: error instanceof RpcError && error.code === -32601 || error instanceof UnsupportedRead ? 'unsupported' : 'error' }; }
}
class UnsupportedRead extends Error {}
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
