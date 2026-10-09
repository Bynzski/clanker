import { ipcMain } from 'electron';
import { HARNESS_USAGE_GET } from '../../shared/ipcChannels';
import type { HarnessUsageRequest } from '../../shared/types/harnessUsage';
import type { HarnessUsageService } from '../usage/harnessUsageService';

export interface RegisterUsageIpcDeps {
  getUsageService: () => HarnessUsageService;
}

/** Only a workspaceId and two plain options cross in; targets, paths and credentials never do. */
function parseRequest(raw: unknown): HarnessUsageRequest {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid usage request');
  const { harnessIds, force } = raw as Record<string, unknown>;
  if (harnessIds !== undefined && (!Array.isArray(harnessIds) || harnessIds.length > 32 || harnessIds.some((id) => typeof id !== 'string'))) {
    throw new Error('Invalid usage request');
  }
  return { harnessIds: harnessIds as string[] | undefined, force: force === true };
}

export function registerUsageIpc(deps: RegisterUsageIpcDeps): void {
  ipcMain.handle(HARNESS_USAGE_GET, async (_event, workspaceId: unknown, request?: unknown) => {
    const parsedRequest = parseRequest(request);
    if (workspaceId === null || workspaceId === undefined || workspaceId === 'local') {
      return deps.getUsageService().getLocal(parsedRequest);
    }
    if (typeof workspaceId !== 'string' || !workspaceId) throw new Error('Workspace is not registered');
    return deps.getUsageService().get(workspaceId, parsedRequest);
  });
}
