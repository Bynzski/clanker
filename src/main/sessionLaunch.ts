import type { HarnessSession } from '../shared/types/session';
import { findHarnessProvider, getHarnessProvider, getHarnessProviders } from './harnesses/registry';
import { HarnessCapabilityError } from './harnesses/types';

/** Compatibility projection; registration belongs to each provider. */
export const SUPPORTED_RESUME_HARNESSES: ReadonlySet<string> = new Set(
  getHarnessProviders().filter((provider) => provider.sessions?.resume).map((provider) => provider.descriptor.id),
);

export function supportsSessionOperation(harness: unknown, fork: boolean, transport: 'local' | 'ssh'): boolean {
  const sessions = findHarnessProvider(harness)?.sessions;
  const operation = fork ? sessions?.fork : sessions?.resume;
  return Boolean(operation && (!operation.transports || operation.transports.includes(transport)));
}

/** User defaults must not override the native conversation selected by main. */
export function assertSessionSelectionFlags(harness: HarnessSession['harness'], flags: string | undefined, transport: 'local' | 'ssh'): void {
  const selectionFlags = getHarnessProvider(harness).sessions?.selectionFlags ?? [];
  if ((flags?.split(/\s+/) ?? []).some((token) => selectionFlags.some((option) => token === option
    || token.startsWith(`${option}=`) || (option.length === 2 && token.startsWith(option))))) {
    throw new Error(`Harness default flags conflict with ${transport === 'ssh' ? 'remote' : 'local'} session selection`);
  }
}

/** Pure provider CLI arguments, shared by local and SSH session launches. */
export function buildSessionCommand(session: HarnessSession, options: { operation: 'resume' | 'fork'; transport: 'local' | 'ssh'; userFlags?: string }) {
  const capability = getHarnessProvider(session.harness).sessions;
  const operation = capability?.[options.operation];
  if (!operation || (operation.transports && !operation.transports.includes(options.transport))) throw new HarnessCapabilityError('unsupported', `${session.harness} session invocation is not supported`);
  return operation.build(session, options.userFlags);
}
