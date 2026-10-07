import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() }, shell: {
  trashItem: vi.fn(async (target: string) => (await import('node:fs/promises')).rm(target, { recursive: true })),
  showItemInFolder: vi.fn(),
} }));
import { ipcMain } from 'electron';
import { registerFileIpc, type RegisterFileIpcDeps } from '../../../src/main/ipc/fileIpc';
import { WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import type { WorkspaceEnvironment } from '../../../src/main/environment/workspaceEnvironment';
import { toPosixPath } from '../../../src/shared/pathNormalize';
import { FILE_LIST_DIRECTORY, FILE_READ, FILE_WRITE, FILE_CREATE, FILE_RENAME, FILE_DELETE, FILE_WATCH, EXPLORER_START_WATCHING } from '../../../src/shared/ipcChannels';

const channels = [FILE_LIST_DIRECTORY, FILE_READ, FILE_WRITE, FILE_CREATE, FILE_RENAME, FILE_DELETE];

describe('checkout-scoped file IPC (real filesystem and registry)', () => {
  let fixture: string, main: string, isolated: string, contextId: string;
  let registry: WorkspaceRegistry;
  const watch = vi.fn(), tree = vi.fn();
  const handle = (channel: string) => vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)![1];
  const call = (channel: string, request: Record<string, unknown>) => handle(channel)({} as never, {
    workspaceId: 'ws', workspacePath: '/forged/broader/root', checkoutContextId: contextId,
    filePath: `${isolated}/same.txt`, directoryPath: isolated, targetPath: `${isolated}/new.txt`, type: 'file',
    oldPath: `${isolated}/same.txt`, newPath: `${isolated}/renamed.txt`, content: 'edited', ...request,
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    fixture = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'clanker-files-')));
    main = toPosixPath(path.join(fixture, 'main'));
    isolated = toPosixPath(path.join(fixture, 'isolated'));
    await fs.mkdir(main); await fs.mkdir(isolated);
    await fs.writeFile(`${main}/same.txt`, 'main'); await fs.writeFile(`${isolated}/same.txt`, 'isolated');
    const environment = { id: 'local', kind: 'local', validateWorkspacePath: async (dir: string) => ({ valid: true, resolvedPath: await fs.realpath(dir) }) } as unknown as WorkspaceEnvironment;
    registry = new WorkspaceRegistry(() => environment);
    await registry.registerWorkspace({ workspaceId: 'ws', workspacePath: main });
    contextId = (await registry.registerCheckoutContext({ workspaceId: 'ws', path: isolated, kind: 'worktree', branch: 'isolated' })).checkoutContext!.id;
    registerFileIpc({
      getWorkspaceRegistry: () => registry,
      getFileWatcher: () => ({ watchFile: watch, markWritten: vi.fn(), releaseHandle: vi.fn() }) as unknown as ReturnType<RegisterFileIpcDeps['getFileWatcher']>,
      getExplorerWatcher: () => ({ watchWorkspace: tree, close: vi.fn() }) as unknown as ReturnType<RegisterFileIpcDeps['getExplorerWatcher']>,
    });
  });
  afterEach(async () => { await fs.rm(fixture, { recursive: true, force: true }); });

  it('reads, writes, lists, creates, renames, deletes and watches only the registered checkout', async () => {
    expect(await call(FILE_READ, {})).toMatchObject({ success: true, content: 'isolated' });
    expect(await call(FILE_WRITE, {})).toMatchObject({ success: true });
    expect(await call(FILE_CREATE, {})).toMatchObject({ success: true });
    expect(await call(FILE_CREATE, { targetPath: `${isolated}/folder`, type: 'directory' })).toMatchObject({ success: true });
    expect(await call(FILE_LIST_DIRECTORY, {})).toMatchObject({ success: true, entries: expect.arrayContaining([expect.objectContaining({ name: 'new.txt' })]) });
    expect(await call(FILE_WATCH, {})).toBe(true);
    expect(watch).toHaveBeenCalledWith(path.join(isolated, 'same.txt'));
    await handle(EXPLORER_START_WATCHING)({} as never, 'ws', contextId);
    expect(tree).toHaveBeenCalledWith(path.normalize(isolated));
    expect(await call(FILE_RENAME, {})).toMatchObject({ success: true });
    expect(await call(FILE_DELETE, { targetPath: `${isolated}/new.txt` })).toMatchObject({ success: true });
    expect(await fs.readFile(`${isolated}/renamed.txt`, 'utf8')).toBe('edited');
    expect(await fs.readFile(`${main}/same.txt`, 'utf8')).toBe('main');
  });

  it.each(channels)('does not widen the checkout for %s even when the renderer supplies its sibling root', async (channel) => {
    expect(await call(channel, { workspacePath: main, filePath: `${main}/same.txt`, directoryPath: main, targetPath: `${main}/new.txt`, oldPath: `${main}/same.txt`, newPath: `${main}/renamed.txt` })).toMatchObject({ success: false });
    expect(await fs.readFile(`${main}/same.txt`, 'utf8')).toBe('main');
  });

  it.each(channels)('refuses another workspace context or a released context for %s', async (channel) => {
    await registry.registerWorkspace({ workspaceId: 'other', workspacePath: main });
    expect(await call(channel, { workspaceId: 'other' })).toMatchObject({ success: false });
    registry.unregisterCheckoutContext(contextId);
    expect(await call(channel, {})).toMatchObject({ success: false });
  });

  it('never treats a context-only request as legacy local authority', async () => {
    expect(await call(FILE_READ, { workspaceId: undefined })).toMatchObject({ success: false });
    expect(await call(FILE_READ, { checkoutContextId: '' })).toMatchObject({ success: false });
    expect(await call(FILE_WATCH, { checkoutContextId: 'unknown' })).toBe(false);
  });

  it('routes every remote operation to the registered checkout root, never a desktop or renderer root', async () => {
    main = '/srv/app'; isolated = '/srv/app-worktrees/alpha';
    const remote = {
      id: 'vps', kind: 'ssh', validateWorkspacePath: vi.fn(async (dir: string) => ({ valid: true, resolvedPath: dir })),
      listDirectory: vi.fn().mockResolvedValue({ success: true, entries: [] }),
      readFile: vi.fn().mockResolvedValue({ success: true, content: 'remote' }),
      writeFile: vi.fn().mockResolvedValue({ success: true }), createFile: vi.fn().mockResolvedValue({ success: true }),
      createDirectory: vi.fn().mockResolvedValue({ success: true }), deleteEntry: vi.fn().mockResolvedValue({ success: true }), renameEntry: vi.fn().mockResolvedValue({ success: true }),
    };
    registry = new WorkspaceRegistry(() => remote as unknown as WorkspaceEnvironment);
    await registry.registerWorkspace({ workspaceId: 'ws', workspacePath: main, environmentId: 'vps' });
    contextId = (await registry.registerCheckoutContext({ workspaceId: 'ws', path: isolated, kind: 'worktree' })).checkoutContext!.id;
    for (const channel of channels) expect(await call(channel, {})).toMatchObject({ success: true });
    await call(FILE_CREATE, { type: 'directory' });
    for (const method of [remote.listDirectory, remote.readFile, remote.writeFile, remote.createFile, remote.createDirectory, remote.deleteEntry, remote.renameEntry]) {
      expect(method).toHaveBeenCalledWith(expect.objectContaining({ workspacePath: isolated }));
    }
    registry.unregisterCheckoutContext(contextId);
    expect(await call(FILE_WRITE, {})).toMatchObject({ success: false });
    expect(remote.writeFile).toHaveBeenCalledTimes(1);
    expect(await call(FILE_WATCH, {})).toBe(false);
    expect(watch).not.toHaveBeenCalled();
  });

  it('retains normal workspace confinement when no checkout is requested', async () => {
    expect(await call(FILE_READ, { checkoutContextId: undefined, filePath: `${main}/same.txt` })).toMatchObject({ success: true, content: 'main' });
    expect(await call(FILE_READ, { checkoutContextId: undefined })).toMatchObject({ success: false });
  });
});
