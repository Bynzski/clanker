import type { CheckoutContext } from '../../src/shared/types/checkoutContext';
import { createMainCheckoutContext } from '../../src/shared/checkoutContext';

interface RegistryDouble {
  // Method syntax (bivariant) so doubles may narrow the id type, as some tests do.
  getWorkspace(workspaceId: string): unknown;
}

interface WorkspaceLike {
  location: { environmentId: string; path: string };
}

/**
 * Gives a hand-written WorkspaceRegistry double the checkout-context methods main code now calls.
 * Every workspace the double returns has a main context derived from its location, with a stable
 * identity per workspace (as the real registry has); `extra` adds non-main contexts. Mutates and
 * returns the same object so existing `vi.fn()` handles on the double keep working.
 */
export function withCheckoutContexts<T extends RegistryDouble>(
  registry: T,
  extra: CheckoutContext[] = [],
): T & {
  resolveCheckoutContext: (workspaceId: string, contextId?: string) => CheckoutContext | null;
  getCheckoutContext: (contextId: string) => CheckoutContext | null;
} {
  const mains = new Map<string, CheckoutContext>();
  const mainFor = (workspaceId: string): CheckoutContext | null => {
    const workspace = registry.getWorkspace(workspaceId) as WorkspaceLike | null | undefined;
    if (!workspace) return null;
    const cached = mains.get(workspaceId);
    if (cached && cached.path === workspace.location.path && cached.environmentId === workspace.location.environmentId) {
      return cached;
    }
    const created = createMainCheckoutContext({
      workspaceId,
      environmentId: workspace.location.environmentId,
      path: workspace.location.path,
    });
    mains.set(workspaceId, created);
    return created;
  };

  const resolveCheckoutContext = (workspaceId: string, contextId?: string): CheckoutContext | null => {
    const main = mainFor(workspaceId);
    if (!main) return null;
    if (!contextId || contextId === main.id) return main;
    return extra.find((context) => context.id === contextId && context.workspaceId === workspaceId) ?? null;
  };
  const getCheckoutContext = (contextId: string): CheckoutContext | null => {
    for (const workspaceId of mains.keys()) {
      const main = mainFor(workspaceId);
      if (main?.id === contextId) return main;
    }
    return extra.find((context) => context.id === contextId) ?? null;
  };
  return Object.assign(registry, { resolveCheckoutContext, getCheckoutContext });
}
