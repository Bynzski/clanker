import { KNOWN_HARNESS_IDS } from '../../src/shared/harnessIds';
import type { HarnessSession } from '../../src/shared/types/session';
import type { DetailedSessionDiscovery } from '../../src/main/sessionHistory';

/** Native-store fixtures used by IPC tests: all mocked providers were read successfully. */
export function successfulSessionDiscovery(sessions: HarnessSession[]): DetailedSessionDiscovery {
  return { sessions, harnessStatus: Object.fromEntries(KNOWN_HARNESS_IDS.map((id) => [id, { status: 'success' as const }])) };
}
