import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
vi.mock('electron', () => ({ app: { getPath: vi.fn(() => os.tmpdir()) }, shell: { openExternal: vi.fn() } }));
import { LocalEnvironment } from '../../../src/main/environment/localEnvironment';
import { WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import { WorkspaceServiceManager } from '../../../src/main/services/workspaceServiceManager';
import { probeRecipePreview } from '../../../src/main/recipePreview';
import { toPosixPath } from '../../../src/shared/pathNormalize';

// Real npm, node-pty, local filesystem containment, TCP readiness, and process-group termination.
describe.skipIf(process.platform === 'win32')('local dev services with real PTYs', () => {
  let root: string;
  let registry: WorkspaceRegistry;
  let manager: WorkspaceServiceManager;
  let terminals: Map<string, { workspaceId: string; checkoutContextId: string }>;
  function fixture(name: string, script = 'node server.cjs') {
    const dir = path.join(root, name); fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { dev: script } }));
    fs.writeFileSync(path.join(dir, 'server.cjs'), `const http = require('node:http');
const server = http.createServer((_, response) => response.end(${JSON.stringify(name)}));
server.listen(0, '127.0.0.1', () => console.log('http://127.0.0.1:' + server.address().port + '/'));
`);
    return toPosixPath(dir);
  }
  beforeEach(async () => {
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-dev-service-')));
    registry = new WorkspaceRegistry(() => new LocalEnvironment());
    terminals = new Map();
    manager = new WorkspaceServiceManager({ registry, getTerminal: (id) => terminals.get(id), getLocation: () => null,
      isShuttingDown: () => false, changed: () => undefined });
    const repo = fixture('repo');
    await registry.registerWorkspace({ workspaceId: 'ws', workspacePath: repo });
    terminals.set('main', { workspaceId: 'ws', checkoutContextId: 'ws::main' });
  });
  afterEach(async () => { await manager.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });
  const start = async (terminalId: string) => {
    const discovered = await manager.discover({ workspaceId: 'ws', terminalId });
    expect(discovered.success).toBe(true);
    return manager.start({ workspaceId: 'ws', terminalId, checkoutContextId: discovered.command!.checkoutContextId, cwd: discovered.command!.cwd, command: discovered.command!.command });
  };
  it('runs two different checkout apps without panes and terminates only the targeted process group', async () => {
    const worktree = (await registry.registerCheckoutContext({ workspaceId: 'ws', path: fixture('worktree'), kind: 'worktree' })).checkoutContext!;
    terminals.set('agent', { workspaceId: 'ws', checkoutContextId: worktree.id });
    const first = await start('main'), second = await start('agent');
    expect(first.success && second.success).toBe(true);
    await vi.waitFor(() => expect(manager.snapshot().services.every((service) => service.previewUrl)).toBe(true), { timeout: 10000 });
    const [one, two] = manager.snapshot().services;
    expect(one.previewUrl).not.toBe(two.previewUrl);
    expect(await (await fetch(one.previewUrl!)).text()).toBe('repo');
    expect(await (await fetch(two.previewUrl!)).text()).toBe('worktree');
    terminals.delete('agent'); // Service lifetime is not the conversation/xterm lifetime.
    expect(await (await fetch(two.previewUrl!)).text()).toBe('worktree');
    await manager.stop('ws', one.id);
    expect((await probeRecipePreview(one.previewUrl!, false)).status).toBe('unavailable');
    expect(await (await fetch(two.previewUrl!)).text()).toBe('worktree');
    await manager.closeWorkspace('ws');
    expect((await probeRecipePreview(two.previewUrl!, false)).status).toBe('unavailable');
    expect(manager.snapshot().services).toEqual([]);
  }, 15000);
  it('reports an immediate failed npm script and shutdown closes a live server', async () => {
    const worktree = (await registry.registerCheckoutContext({ workspaceId: 'ws', path: fixture('broken', 'node -e "process.exit(7)"'), kind: 'worktree' })).checkoutContext!;
    terminals.set('broken', { workspaceId: 'ws', checkoutContextId: worktree.id });
    await start('broken'); await start('main');
    await vi.waitFor(() => {
      expect(manager.snapshot().services[0].status).toBe('failed');
      expect(manager.snapshot().services[1].previewUrl).toBeTruthy();
    }, { timeout: 10000 });
    const url = manager.snapshot().services[1].previewUrl!;
    await manager.shutdown();
    expect((await probeRecipePreview(url, false)).status).toBe('unavailable');
  }, 15000);
  it('records a symlinked checkout physical cwd and refuses retargeting between discovery and Run', async () => {
    const first = fixture('first'), second = fixture('second');
    const link = path.join(root, 'linked'); fs.symlinkSync(first, link, 'dir');
    const context = (await registry.registerCheckoutContext({ workspaceId: 'ws', path: toPosixPath(link), kind: 'worktree' })).checkoutContext!;
    terminals.set('linked', { workspaceId: 'ws', checkoutContextId: context.id });
    const discovery = await manager.discover({ workspaceId: 'ws', terminalId: 'linked' });
    expect(discovery.command).toMatchObject({ checkoutRoot: toPosixPath(link), cwd: first });
    fs.unlinkSync(link); fs.symlinkSync(second, link, 'dir');
    expect(await manager.start({ workspaceId: 'ws', terminalId: 'linked', checkoutContextId: context.id, cwd: discovery.command!.cwd, command: discovery.command!.command })).toMatchObject({ success: false });
    expect(manager.snapshot().services).toEqual([]);
    const started = await start('linked');
    expect(started.service).toMatchObject({ cwd: second, checkoutRoot: toPosixPath(link) });
  });
  it('does not read symlinked package metadata outside the independently validated checkout root', async () => {
    const repo = registry.resolveCheckoutContext('ws')!.path;
    const outside = path.join(root, 'outside.json');
    fs.writeFileSync(outside, '{"scripts":{"dev":"node server.cjs"}}');
    fs.unlinkSync(path.join(repo, 'package.json')); fs.symlinkSync(outside, path.join(repo, 'package.json'));
    expect((await manager.discover({ workspaceId: 'ws', terminalId: 'main' })).success).toBe(false);
    expect(manager.snapshot().services).toEqual([]);
  });
});
