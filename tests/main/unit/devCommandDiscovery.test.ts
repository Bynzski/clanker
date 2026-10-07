import { describe, expect, it, vi } from 'vitest';
import { discoverDevCommand } from '../../../src/main/services/devCommandDiscovery';
import type { WorkspaceEnvironment } from '../../../src/main/environment/workspaceEnvironment';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';

const context: CheckoutContext = { id: 'ws::main', workspaceId: 'ws', environmentId: 'local', kind: 'main', path: '/repo' };
const environment = (manifest: unknown, locks: string[] = []) => ({
  readFile: vi.fn(async () => ({ success: true, content: JSON.stringify(manifest) })),
  listDirectory: vi.fn(async () => ({ success: true, entries: locks.map((name) => ({ name, isDirectory: false })) })),
}) as unknown as WorkspaceEnvironment;

describe('deterministic dev command discovery', () => {
  it.each([
    [[], 'npm', 'npm run dev'], [['package-lock.json'], 'npm', 'npm run dev'], [['npm-shrinkwrap.json'], 'npm', 'npm run dev'],
    [['pnpm-lock.yaml'], 'pnpm', 'pnpm run dev'], [['yarn.lock'], 'yarn', 'yarn dev'], [['bun.lock'], 'bun', 'bun run dev'],
    [['bun.lockb'], 'bun', 'bun run dev'], [['yarn.lock', 'bun.lock', 'pnpm-lock.yaml', 'package-lock.json'], 'pnpm', 'pnpm run dev'],
  ])('selects from lockfiles %j', async (locks, manager, command) => {
    expect(await discoverDevCommand(environment({ scripts: { dev: 'vite' } }, locks as string[]), context)).toMatchObject({ packageManager: manager, command });
  });
  it.each(['npm', 'pnpm', 'yarn', 'bun'])('prefers valid packageManager metadata %s', async (manager) => {
    const env = environment({ scripts: { dev: 'vite' }, packageManager: `${manager}@1.2.3` }, ['pnpm-lock.yaml']);
    expect((await discoverDevCommand(env, context))?.packageManager).toBe(manager);
    expect(env.listDirectory).not.toHaveBeenCalled();
  });
  it.each(['pnpm; evil@1.2.3', 'pnpm', 'unknown@1.2.3', '../../evil@1.2.3'])('does not interpolate invalid metadata %s', async (packageManager) => {
    expect((await discoverDevCommand(environment({ scripts: { dev: 'anything' }, packageManager }, ['yarn.lock']), context))?.command).toBe('yarn dev');
  });
  it.each([{}, { scripts: { start: 'node app.js' } }, { scripts: { dev: '' } }, { scripts: { dev: 123 } }, null])('does not guess absent/invalid dev scripts %j', async (manifest) => {
    expect(await discoverDevCommand(environment(manifest), context)).toBeUndefined();
  });
  it('reports malformed or inaccessible package metadata but treats absent package.json as no command', async () => {
    const env = environment({});
    vi.mocked(env.readFile).mockResolvedValueOnce({ success: true, content: '{' });
    await expect(discoverDevCommand(env, context)).rejects.toThrow('Invalid package.json');
    vi.mocked(env.readFile).mockResolvedValueOnce({ success: false, errorCode: 'not-found' });
    expect(await discoverDevCommand(env, context)).toBeUndefined();
    vi.mocked(env.readFile).mockResolvedValueOnce({ success: false, errorCode: 'file-too-large', error: 'Too large' });
    await expect(discoverDevCommand(env, context)).rejects.toThrow('Too large');
  });
  it('inspects the exact registered worktree root, never its descriptive mainCheckoutPath', async () => {
    const env = environment({ scripts: { dev: 'vite' } });
    const worktree = { ...context, id: 'wt', kind: 'worktree' as const, path: '/repo-worktrees/a', mainCheckoutPath: '/repo' };
    expect((await discoverDevCommand(env, worktree))?.cwd).toBe(worktree.path);
    expect(env.readFile).toHaveBeenCalledExactlyOnceWith({ workspacePath: worktree.path, filePath: `${worktree.path}/package.json` });
    expect(env.listDirectory).toHaveBeenCalledExactlyOnceWith({ workspacePath: worktree.path, directoryPath: worktree.path });
  });
});
