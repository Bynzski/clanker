import { DEFAULT_ASSISTANT_SETTINGS, isValidAssistantId, type AssistantSettings } from '../../shared/types/assistants';

function hiddenIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 64 || Array.from(value).some((id) => !isValidAssistantId(id))) throw new Error('Invalid assistant visibility settings');
  return [...new Set(value as string[])];
}

/** Strict renderer validation: two booleans and a bounded opaque-id visibility preference. */
export function validateAssistantSettings(value: unknown): AssistantSettings {
  if (!value || typeof value !== 'object') throw new Error('Invalid assistant settings');
  const input = value as Record<string, unknown>;
  if (typeof input.enabled !== 'boolean' || typeof input.autoStart !== 'boolean') throw new Error('Invalid assistant settings');
  const hiddenAssistantIds = hiddenIds(input.hiddenAssistantIds);
  return { enabled: input.enabled, autoStart: input.autoStart, ...(hiddenAssistantIds ? { hiddenAssistantIds } : {}) };
}

/**
 * Tolerant read of persisted settings. A developer config from the superseded pin prototype keeps
 * `enabled`, drops `pins` and unknown properties, and defaults `autoStart` to false.
 * Invalid visibility data is dropped independently of the enable/autostart preferences. Never throws.
 */
export function readPersistedAssistantSettings(value: unknown): AssistantSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_ASSISTANT_SETTINGS };
  const input = value as Record<string, unknown>;
  let hiddenAssistantIds: string[] | undefined;
  try { hiddenAssistantIds = hiddenIds(input.hiddenAssistantIds); } catch { /* Bad visibility data never prevents startup. */ }
  return { enabled: input.enabled === true, autoStart: input.autoStart === true, ...(hiddenAssistantIds ? { hiddenAssistantIds } : {}) };
}
