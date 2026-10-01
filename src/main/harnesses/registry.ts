import { KNOWN_HARNESS_IDS, type HarnessId } from '../../shared/harnessIds';
import type { HarnessProvider } from './types';
import { codexProvider } from './codex';
import { opencodeProvider } from './opencode';
import { piProvider } from './pi';
import { ompProvider } from './omp';
import { claudeProvider } from './claude';
import { hermesProvider } from './hermes';
import { agyProvider } from './agy';

// A fixed record has no mutable registration path or duplicate registrations.
const providers = Object.freeze({
  codex: codexProvider,
  opencode: opencodeProvider,
  pi: piProvider,
  omp: ompProvider,
  claude: claudeProvider,
  hermes: hermesProvider,
  agy: agyProvider,
} satisfies Record<HarnessId, HarnessProvider>);

export function isHarnessId(value: unknown): value is HarnessId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(providers, value);
}

export function getHarnessProvider(id: HarnessId): HarnessProvider {
  if (!isHarnessId(id)) throw new Error(`Unknown harness: ${String(id)}`);
  return providers[id];
}

export function findHarnessProvider(value: unknown): HarnessProvider | undefined {
  return isHarnessId(value) ? getHarnessProvider(value) : undefined;
}

export function getHarnessProviders(): readonly HarnessProvider[] {
  return KNOWN_HARNESS_IDS.map(getHarnessProvider);
}

/** Capability-aware IDs derive from implementations, not a support allowlist. */
export type HarnessWithCapability<Capability extends keyof HarnessProvider> = {
  [Id in HarnessId]: Capability extends keyof typeof providers[Id] ? Id : never
}[HarnessId];
