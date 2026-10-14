import { createHash, randomUUID } from 'node:crypto';
import { ASSISTANT_TAGLINE_LIMIT, ASSISTANT_TITLE_LIMIT, type AssistantAvatar, type AssistantPresentation, type AssistantPresentationWriteResult } from '../../shared/types/assistantPresentation';
import { isValidAssistantId, type HermesAssistant } from '../../shared/types/assistants';
import { displayText, record } from './assistantDetails';
import { parseAssistantAvatar, UnsupportedAvatarFormat, type AvatarDecoder } from './assistantAvatar';
import { HermesRpcClient, RpcError } from './hermesTransport';

const BOT_META = 'hermes-bots';
interface Metadata {
  bot: Record<string, unknown>;
  revision: number | null;
  fingerprint: string;
  title: string;
  tagline: string;
  editable: boolean;
  hasAvatar?: boolean;
}
export interface PresentationBinding {
  slug: string;
  rpc: HermesRpcClient;
  live(): boolean;
  /** Re-read through the owning service, never reconnect or start a backend for a write. */
  reload(): Promise<void>;
}
interface EditView { token: string; fingerprint: string; rpc: HermesRpcClient }

/** Private metadata/CAS snapshots and bounded avatar work, separate from the chat/service lifecycle. */
export class AssistantPresentationService {
  private metadata = new Map<string, Metadata>();
  private views = new Map<string, EditView>();
  private writes = new Set<string>();
  private unsupportedWrites = false;
  private avatarEpoch = 0;
  private avatarCache = new Map<string, { value: AssistantAvatar; until: number }>();
  private avatarReads = new Map<string, Promise<AssistantAvatar>>();
  private avatarSlots: Promise<void>[] = Array.from({ length: 4 }, () => Promise.resolve());
  private nextSlot = 0;

  constructor(private readonly resolve: (id: unknown) => PresentationBinding | undefined, private readonly decode?: AvatarDecoder, private readonly now = Date.now) {}

  get revision(): number { return this.avatarEpoch; }

  reset(): void {
    this.metadata.clear(); this.views.clear(); this.avatarCache.clear(); this.avatarEpoch++;
    this.unsupportedWrites = false;
    // Keep pending RPCs/queue entries accounted for until their bounded calls settle.
  }

  /** Only namespace metadata for the service's already-validated named local roster is retained. */
  acceptRoster(result: unknown, assistants: HermesAssistant[], token: string): void {
    const profiles = record(result).profiles;
    const next = new Map<string, Metadata>();
    if (Array.isArray(profiles)) {
      for (const assistant of assistants) {
        const slug = assistant.id.slice('hermes:'.length);
        const matches = profiles.filter((raw) => record(raw).name === slug);
        if (matches.length !== 1) continue; // Duplicate/conflicting identity never grants edit authority.
        const row = record(matches[0]); const ui = record(row.ui_meta); const rawBot = ui[BOT_META];
        const bot = record(rawBot);
        let safeNumbers = true;
        const serialized = JSON.stringify(bot, (_key, value: unknown) => {
          if (typeof value === 'number' && (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value) || Object.is(value, -0))) safeNumbers = false;
          return value;
        });
        // Conservative ASCII-escaped wire budget including Python json.dumps spacing (native cap 64 KiB).
        const bounded = serialized.replace(/[^\x00-\x7f]/g, 'xxxxxx').length * 2 <= 65536;
        const revisions = row.ui_meta_revisions;
        const revision = Object.prototype.hasOwnProperty.call(record(revisions), BOT_META) ? record(revisions)[BOT_META] : 0;
        const supportsCas = revisions !== null && typeof revisions === 'object' && !Array.isArray(revisions) &&
          Number.isSafeInteger(revision) && (revision as number) >= 0 && (revision as number) < Number.MAX_SAFE_INTEGER;
        const privateValues = [token, typeof row.path === 'string' ? row.path : ''];
        const safe = (value: unknown, limit: number) => displayText(value, limit, privateValues) ?? '';
        const title = safe(bot.title, ASSISTANT_TITLE_LIMIT); const tagline = safe(bot.description, ASSISTANT_TAGLINE_LIMIT);
        const cleanText = (value: unknown, text: string) => value === undefined || typeof value === 'string' && value.trim() === text;
        next.set(assistant.id, { bot: bounded ? bot : {}, revision: supportsCas ? revision as number : null,
          fingerprint: createHash('sha256').update(`${supportsCas ? String(revision) : 'unsupported'}:${serialized}`).digest('hex'), title, tagline,
          editable: bounded && safeNumbers && (row.ui_meta === undefined || row.ui_meta !== null && typeof row.ui_meta === 'object' && !Array.isArray(row.ui_meta)) && (rawBot === undefined || rawBot !== null && typeof rawBot === 'object' && !Array.isArray(rawBot)) &&
            cleanText(bot.title, title) && cleanText(bot.description, tagline),
          hasAvatar: typeof row.has_avatar === 'boolean' ? row.has_avatar : undefined });
      }
    }
    this.metadata = next;
    for (const [id, view] of this.views) if (next.get(id)?.fingerprint !== view.fingerprint) this.views.delete(id);
    this.avatarCache.clear(); this.avatarEpoch++;
  }

  read(id: unknown): AssistantPresentation {
    const assistantId = isValidAssistantId(id) ? id : '';
    const binding = this.resolve(id);
    if (!binding) return { assistantId, cosmetics: { state: 'unavailable' } };
    const meta = this.metadata.get(assistantId);
    if (!meta) return { assistantId, cosmetics: { state: 'error' } };
    let view = this.views.get(assistantId);
    if (!view || view.rpc !== binding.rpc || view.fingerprint !== meta.fingerprint) {
      view = { token: randomUUID(), fingerprint: meta.fingerprint, rpc: binding.rpc };
      this.views.set(assistantId, view);
    }
    return { assistantId, cosmetics: { state: 'ready', data: { title: meta.title, tagline: meta.tagline,
      ...(meta.revision !== null && meta.editable && !this.unsupportedWrites ? { editToken: view.token } : {}) } } };
  }

  async update(id: unknown, value: unknown): Promise<AssistantPresentationWriteResult> {
    const binding = this.resolve(id);
    if (!binding || typeof id !== 'string') return { state: 'unavailable' };
    const input = record(value);
    if (Object.keys(input).some((key) => !['title', 'tagline', 'editToken'].includes(key)) || typeof input.editToken !== 'string' || input.editToken.length !== 36 ||
      typeof input.title !== 'string' || typeof input.tagline !== 'string' || input.title.length > ASSISTANT_TITLE_LIMIT ||
      input.tagline.length > ASSISTANT_TAGLINE_LIMIT || /[\x00-\x1f\x7f]/.test(input.title + input.tagline)) return { state: 'invalid' };
    const view = this.views.get(id);
    if (!view || view.token !== input.editToken || view.rpc !== binding.rpc) return { state: 'conflict', presentation: this.read(id) };
    if (this.writes.has(id) || this.writes.size >= 4) return { state: 'unavailable' };
    this.writes.add(id);
    try {
      // Fresh native read before the merge. Do not silently rebase an old editor over another client's update.
      await binding.reload();
      if (!binding.live()) return { state: 'unavailable' };
      const meta = this.metadata.get(id);
      if (!meta || this.views.get(id)?.token !== view.token || meta.fingerprint !== view.fingerprint) return { state: 'conflict', presentation: this.read(id) };
      if (meta.revision === null || !meta.editable || this.unsupportedWrites) return { state: 'unsupported', presentation: this.read(id) };
      const revision = meta.revision;
      const title = input.title.trim(); const tagline = input.tagline.trim();
      // Namespace replacement, not a recursive merge: retain ALL unknown visibility/grouping/presentation fields.
      const bot = { ...meta.bot, title, description: tagline };
      let state: AssistantPresentationWriteResult['state'] = 'error';
      try {
        const reply = record(await binding.rpc.call('profiles.configure', {
          name: binding.slug, ui_meta: { [BOT_META]: bot }, ui_meta_expected_revisions: { [BOT_META]: revision },
        }));
        const applied = record(reply.applied);
        if (Object.prototype.hasOwnProperty.call(record(applied.ui_meta_conflicts), BOT_META)) state = 'conflict';
        else if (reply.ok === true && applied.ui_meta === true && record(applied.ui_meta_revisions)[BOT_META] === revision + 1) state = 'saved';
      } catch (error) {
        if (error instanceof RpcError && error.code === -32601) { if (binding.live()) this.unsupportedWrites = true; state = 'unsupported'; }
        // Other errors/timeouts have unknown outcomes. Never echo raw backend errors or assume no write happened.
      }
      if (!binding.live()) return { state: 'unavailable' };
      await binding.reload(); // A rejected or unconfirmed write also refreshes authoritative values.
      if (!binding.live()) return { state: 'unavailable' };
      const fresh = this.metadata.get(id);
      if (state === 'saved' && (fresh?.revision !== revision + 1 || fresh.bot.title !== title || fresh.bot.description !== tagline)) state = 'conflict';
      return { state, presentation: this.read(id) };
    } catch {
      return { state: binding.live() ? 'error' : 'unavailable' };
    } finally { this.writes.delete(id); }
  }

  avatar(id: unknown): Promise<AssistantAvatar> {
    const binding = this.resolve(id);
    if (!binding || typeof id !== 'string' || !this.metadata.has(id)) return Promise.resolve({ state: 'unavailable' });
    const cached = this.avatarCache.get(id);
    if (cached && cached.until > this.now()) return Promise.resolve(cached.value);
    const epoch = this.avatarEpoch;
    const key = `${epoch}:${id}`;
    const pending = this.avatarReads.get(key); if (pending) return pending;
    if (this.avatarReads.size >= 64) return Promise.resolve({ state: 'unavailable' });
    const slot = this.nextSlot;
    this.nextSlot = (slot + 1) % this.avatarSlots.length;
    const operation = this.avatarSlots[slot].then(async (): Promise<AssistantAvatar> => {
      if (!binding.live() || epoch !== this.avatarEpoch) return { state: 'unavailable' };
      let value: AssistantAvatar;
      try {
        value = this.metadata.get(id)?.hasAvatar === false ? { state: 'ready', data: null }
          : parseAssistantAvatar(await binding.rpc.call('profiles.get_asset', { name: binding.slug, asset: 'avatar' }), this.decode);
      } catch (error) { value = { state: error instanceof UnsupportedAvatarFormat || error instanceof RpcError && error.code === -32601 ? 'unsupported' : 'error' }; }
      if (!binding.live() || epoch !== this.avatarEpoch) return { state: 'unavailable' };
      this.avatarCache.delete(id);
      this.avatarCache.set(id, { value, until: this.now() + 60_000 });
      while (this.avatarCache.size > 16) this.avatarCache.delete(this.avatarCache.keys().next().value!);
      return value;
    }).finally(() => { if (this.avatarReads.get(key) === operation) this.avatarReads.delete(key); });
    this.avatarReads.set(key, operation);
    this.avatarSlots[slot] = operation.then(() => undefined, () => undefined);
    return operation;
  }
}
