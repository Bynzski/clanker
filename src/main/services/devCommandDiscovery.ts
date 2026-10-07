import * as path from 'node:path';
import type { WorkspaceEnvironment } from '../environment/workspaceEnvironment';
import type { CheckoutContext } from '../../shared/types/checkoutContext';
import type { DevServiceCommand } from '../../shared/types/workspaceServices';

const MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'] as const;
/** Metadata only: never invoke tooling or interpolate project script text into a shell command. */
export async function discoverDevCommand(environment: WorkspaceEnvironment, context: CheckoutContext): Promise<DevServiceCommand | undefined> {
  const result = await environment.readFile({ workspacePath: context.path, filePath: path.posix.join(context.path, 'package.json') });
  if (!result.success) {
    if (result.errorCode === 'not-found') return undefined;
    throw new Error(result.error || 'Could not read package.json');
  }
  let manifest: unknown;
  try { manifest = JSON.parse(result.content ?? ''); } catch { throw new Error('Invalid package.json'); }
  if (!manifest || typeof manifest !== 'object') return undefined;
  const { scripts, packageManager } = manifest as { scripts?: Record<string, unknown>; packageManager?: unknown };
  if (!scripts || typeof scripts.dev !== 'string' || !scripts.dev.trim()) return undefined;
  let manager: DevServiceCommand['packageManager'] = 'npm';
  const explicit = typeof packageManager === 'string' ? /^(npm|pnpm|yarn|bun)@\d+\.\d+\.\d+(?:[-+][\w.+-]+)?$/.exec(packageManager) : null;
  if (explicit) manager = explicit[1] as typeof manager;
  else {
    const listing = await environment.listDirectory({ workspacePath: context.path, directoryPath: context.path });
    if (!listing.success) throw new Error(listing.error || 'Could not inspect package manager lockfiles');
    const names = new Set(listing.entries.filter((entry) => !entry.isDirectory).map((entry) => entry.name));
    if (names.has('pnpm-lock.yaml')) manager = 'pnpm';
    else if (names.has('yarn.lock')) manager = 'yarn';
    else if (names.has('bun.lock') || names.has('bun.lockb')) manager = 'bun';
  }
  if (!MANAGERS.includes(manager)) throw new Error('Unsupported package manager');
  return {
    workspaceId: context.workspaceId, checkoutContextId: context.id, checkoutRoot: context.path, cwd: context.path,
    packageManager: manager, command: manager === 'yarn' ? 'yarn dev' : `${manager} run dev`,
  };
}
