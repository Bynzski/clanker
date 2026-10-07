import * as path from 'node:path';
import type { HarnessSession } from '../shared/types/session';
import { DEFAULT_HARNESS_ACCOUNT_ID } from '../shared/types/harnessAccounts';
import { toNativePath, toPosixPath } from '../shared/pathNormalize';
import { discoverSessionsDetailed } from './sessionHistory';
import { discoverSessionsWithCheckouts, sessionPathOps, type SessionCheckoutPlan } from './sessionWorktrees';

/** Identity-only selection; every launch-affecting field comes from fresh main-owned discovery. */
export interface LocalSessionSelection {
  harness: HarnessSession['harness'];
  id: string;
}

/** Conflicting native launch evidence must not be hidden by history's display deduplication. */
function launchIdentity(session: HarnessSession): string {
  return JSON.stringify([session.modelId ?? null, session.provider ?? null]);
}

function validLaunch(session: HarnessSession): boolean {
  const absolute = (value: unknown): value is string => typeof value === 'string' && !!value
    && !/[\u0000-\u001f\u007f]/.test(value) && path.isAbsolute(toNativePath(value, process.platform));
  return absolute(session.cwd) && (session.filePath === undefined || absolute(session.filePath))
    && (session.modelId === undefined || typeof session.modelId === 'string')
    && (session.provider === undefined || typeof session.provider === 'string');
}

function sameLaunch(left: HarnessSession, right: HarnessSession): boolean {
  const ops = sessionPathOps('local');
  const samePath = (a: string, b: string) => ops.same(ops.canonical(toPosixPath(a)), ops.canonical(toPosixPath(b)));
  return samePath(left.cwd, right.cwd)
    && (left.filePath === undefined && right.filePath === undefined
      || typeof left.filePath === 'string' && typeof right.filePath === 'string' && samePath(left.filePath, right.filePath))
    && launchIdentity(left) === launchIdentity(right);
}

/**
 * Fresh native/default-account discovery across the same bounded checkout scopes history uses.
 * Capture matching rows BEFORE presentation dedup/filtering, including conflicts returned by different
 * scopes. A selected-provider/scope failure makes authority unverifiable; unrelated provider failures
 * do not block a verified conversation. Managed homes are deliberately absent from this scan.
 */
export async function rediscoverDefaultLocalSession(params: {
  selection: LocalSessionSelection;
  workspacePath: string;
  plan: SessionCheckoutPlan | null;
}): Promise<HarnessSession> {
  const candidates: HarnessSession[] = [];
  let incomplete = false;
  const discover = async (scanPath: string): Promise<HarnessSession[]> => {
    const found = await discoverSessionsDetailed(scanPath, { forceRefresh: true });
    if (found.harnessStatus[params.selection.harness]?.status !== 'success') incomplete = true;
    const matching = found.sessions.filter((session) => session?.harness === params.selection.harness && session.id === params.selection.id
      && (session.accountId === undefined || session.accountId === DEFAULT_HARNESS_ACCOUNT_ID));
    candidates.push(...matching);
    // Other providers' presentation rows have no bearing on this native identity.
    return matching.filter(validLaunch);
  };
  try {
    if (params.plan) {
      await discoverSessionsWithCheckouts({
        plan: params.plan, scanWorkspacePath: toNativePath(params.workspacePath, process.platform), discover,
        toScanPath: (value) => toNativePath(value, process.platform),
        onScanError: () => { incomplete = true; },
      });
    } else {
      await discover(toNativePath(params.workspacePath, process.platform));
    }
  } catch {
    incomplete = true;
  }
  if (incomplete) throw new Error('Session history could not be verified. Refresh History and try again.');
  const session = candidates[0];
  if (!session) throw new Error('Session was not found in this workspace. Refresh History and try again.');
  if (!validLaunch(session) || candidates.some((candidate) => !validLaunch(candidate) || !sameLaunch(session, candidate))) {
    throw new Error('Conflicting or invalid native session metadata. Refresh History and try again.');
  }
  // Do not carry history-only checkout tags forward as routing evidence.
  // Route by the real local cwd when present: a lexical in-workspace symlink must not authorize
  // a conversation whose native working directory actually lives outside the checkout.
  const authoritative = { ...session, cwd: sessionPathOps('local').canonical(toPosixPath(session.cwd)) };
  delete authoritative.checkout;
  return authoritative;
}
