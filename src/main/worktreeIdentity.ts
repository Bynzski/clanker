import * as fs from 'node:fs';
import { toNativePath, toPosixPath } from '../shared/pathNormalize';
import { isSameWorkspaceIdentity } from '../shared/workspaceIdentity';
import type { RegisteredWorkspace } from './workspaceRegistry';

/** Metadata validation only; this never registers a directory or widens an execution root. */
export async function canonicalCheckoutDirectory(workspace: RegisteredWorkspace, directory: string): Promise<string> {
  const result = await workspace.environment.validateWorkspacePath(directory);
  if (!result.valid || !result.resolvedPath) throw new Error('Checkout directory is unavailable');
  return workspace.location.environmentId === 'local'
    ? toPosixPath(fs.realpathSync.native(toNativePath(result.resolvedPath, process.platform))) : result.resolvedPath;
}

/** A Git listing can outlive the directory it names. Prove the physical checkout still belongs
 * to the workspace repository before granting it, including replacement by another real repo. */
export async function verifyListedWorktreeIdentity(workspace: RegisteredWorkspace, listedPath: string): Promise<void> {
  const same = (a: string, b: string) => isSameWorkspaceIdentity(
    { environmentId: workspace.location.environmentId, path: a }, { environmentId: workspace.location.environmentId, path: b });
  const canonical = await canonicalCheckoutDirectory(workspace, listedPath);
  if (!same(canonical, listedPath)) throw new Error('Git worktree path is no longer canonical');
  const args = ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'];
  const [origin, target] = await Promise.all([
    workspace.environment.execGit(workspace.location.path, args), workspace.environment.execGit(canonical, args),
  ]);
  const parse = (text: string) => {
    if (Buffer.byteLength(text) > 16384) throw new Error('Invalid Git checkout identity');
    const fields = text.trimEnd().split(/\r?\n/).map(toPosixPath);
    if (fields.length !== 2 || fields.some(field => !field || /[\x00-\x1f\x7f]/.test(field))) throw new Error('Invalid Git checkout identity');
    return fields;
  };
  const source = parse(origin.stdout), checkout = parse(target.stdout);
  const [sourceCommon, targetCommon] = await Promise.all([
    canonicalCheckoutDirectory(workspace, source[1]), canonicalCheckoutDirectory(workspace, checkout[1]),
  ]);
  if (!same(checkout[0], canonical) || !same(sourceCommon, targetCommon)) {
    throw new Error('Worktree repository identity changed; refresh worktrees');
  }
}
