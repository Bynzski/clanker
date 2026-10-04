/**
 * Browser ownership. The native Browser layer keys views by one opaque owner string. A Workspace's
 * owner is its workspace id; an Assistant's is a deterministic scope derived from its opaque
 * Assistant id. Main validates the owner before any view exists (an Assistant owner must currently
 * resolve through the Hermes Assistant service); the renderer never supplies a richer object.
 */
export const ASSISTANT_BROWSER_OWNER_PREFIX = 'assistant-browser:';

export function assistantBrowserOwnerId(assistantId: string): string {
  return `${ASSISTANT_BROWSER_OWNER_PREFIX}${assistantId}`;
}

/** The Assistant id behind an Assistant browser owner, or null for any other owner. */
export function assistantIdFromBrowserOwner(ownerId: string): string | null {
  return ownerId.startsWith(ASSISTANT_BROWSER_OWNER_PREFIX) ? ownerId.slice(ASSISTANT_BROWSER_OWNER_PREFIX.length) : null;
}
