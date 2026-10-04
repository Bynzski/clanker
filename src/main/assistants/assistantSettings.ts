import { DEFAULT_ASSISTANT_SETTINGS, type AssistantSettings } from '../../shared/types/assistants';

/** Strict validation for renderer-supplied settings: exactly the two booleans. */
export function validateAssistantSettings(value: unknown): AssistantSettings {
  if (!value || typeof value !== 'object') throw new Error('Invalid assistant settings');
  const input = value as Record<string, unknown>;
  if (typeof input.enabled !== 'boolean' || typeof input.autoStart !== 'boolean') throw new Error('Invalid assistant settings');
  return { enabled: input.enabled, autoStart: input.autoStart };
}

/**
 * Tolerant read of persisted settings. A developer config from the superseded pin prototype keeps
 * `enabled`, drops `pins` and any other property, and defaults `autoStart` to false. Never throws.
 */
export function readPersistedAssistantSettings(value: unknown): AssistantSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_ASSISTANT_SETTINGS };
  const input = value as Record<string, unknown>;
  return { enabled: input.enabled === true, autoStart: input.autoStart === true };
}
