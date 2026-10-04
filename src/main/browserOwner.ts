import { assistantIdFromBrowserOwner } from '../shared/browserOwner';

export interface BrowserOwnerResolvers {
  /** True only while the Assistant service currently resolves this opaque Assistant id. */
  hasAssistant(assistantId: string): boolean;
  /** The registered workspace's environment kind, or null when it is not registered. */
  getWorkspaceKind(workspaceId: string): 'local' | 'ssh' | null;
}

/**
 * Main's authority over Browser ownership. An Assistant owner is always local and exists only while the
 * Assistant service resolves its id (a fabricated id yields null, so no view or session is created);
 * every other owner is a workspace and keeps its registry-derived local/SSH behavior.
 */
export function resolveBrowserOwnerKind(ownerId: string, resolvers: BrowserOwnerResolvers): 'local' | 'ssh' | null {
  const assistantId = assistantIdFromBrowserOwner(ownerId);
  if (assistantId !== null) return resolvers.hasAssistant(assistantId) ? 'local' : null;
  return resolvers.getWorkspaceKind(ownerId);
}

/** Browser owners that belong to Assistants (the ones to dispose when Assistants are disabled or unavailable). */
export function assistantBrowserOwners(owners: Iterable<string>): string[] {
  return [...owners].filter((owner) => assistantIdFromBrowserOwner(owner) !== null);
}
