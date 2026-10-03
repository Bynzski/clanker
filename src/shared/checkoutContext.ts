import type { CheckoutContext } from './types/checkoutContext';
import type { WorkspaceEnvironmentId } from './types/environments';
import { LOCAL_ENVIRONMENT_ID } from './types/environments';
import { normalizeWorkspacePath } from './workspaceIdentity';

/** The main context's id is derivable, so legacy workspaces and terminals backfill without a migration. */
export function mainCheckoutContextId(workspaceId: string): string {
  return `${workspaceId}::main`;
}

export function createMainCheckoutContext(input: {
  workspaceId: string;
  environmentId?: WorkspaceEnvironmentId;
  path: string;
}): CheckoutContext {
  return {
    id: mainCheckoutContextId(input.workspaceId),
    workspaceId: input.workspaceId,
    environmentId: input.environmentId || LOCAL_ENVIRONMENT_ID,
    path: normalizeWorkspacePath(input.path),
    kind: 'main',
  };
}
