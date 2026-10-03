import path from 'node:path';
import type { AssistantPin, AssistantSettings } from '../../shared/types/assistants';
import { isValidHarnessProfileName } from '../../shared/harnessProfiles';
import { isValidWorkspaceEnvironmentId } from '../../shared/sshValidation';
import { normalizeWorkspacePath, workspaceIdentityKey } from '../../shared/workspaceIdentity';
import { KNOWN_HARNESS_IDS } from '../../shared/harnessIds';

const MAX_PINS = 128;

/** Whitelist durable presentation fields; no provider config, paths to profiles or auth data. */
export function validateAssistantSettings(value: unknown): AssistantSettings {
  if (!value || typeof value !== 'object') throw new Error('Invalid assistant settings');
  const input = value as Partial<AssistantSettings>;
  if (typeof input.enabled !== 'boolean' || !Array.isArray(input.pins) || input.pins.length > MAX_PINS) throw new Error('Invalid assistant settings');
  const pins = new Map<string, AssistantPin>();
  for (const entry of input.pins) {
    if (!entry || typeof entry !== 'object' || !(KNOWN_HARNESS_IDS as readonly unknown[]).includes(entry.harnessId) || !isValidHarnessProfileName(entry.profileName)) throw new Error('Invalid assistant pin');
    const pin: AssistantPin = { harnessId: entry.harnessId, profileName: entry.profileName };
    if (entry.workspace !== undefined) {
      const location = entry.workspace;
      if (!location || typeof location !== 'object' || !isValidWorkspaceEnvironmentId(location.environmentId) || typeof location.path !== 'string' || location.path.length > 4096 || /[\x00-\x1f\x7f]/.test(location.path)) throw new Error('Invalid assistant workspace pin');
      const canonical = normalizeWorkspacePath(location.path);
      const absolute = location.environmentId === 'local' ? path.isAbsolute(canonical) || path.win32.isAbsolute(canonical) : canonical.startsWith('/');
      if (!absolute || canonical.split('/').some((part) => part === '.' || part === '..')) throw new Error('Invalid assistant workspace pin');
      pin.workspace = { environmentId: location.environmentId, path: canonical };
    }
    const key = `${pin.harnessId}:${pin.profileName}:${pin.workspace ? workspaceIdentityKey(pin.workspace) : 'global'}`;
    pins.set(key, pin);
  }
  return { enabled: input.enabled, pins: [...pins.values()] };
}
