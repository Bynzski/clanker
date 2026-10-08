import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as net from 'node:net';
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

  describe('process lifecycle (real npm → sh → node trees)', () => {
    const openServers: net.Server[] = [];
    afterEach(async () => { await Promise.all(openServers.splice(0).map((server) => new Promise((resolve) => server.close(resolve)))); });
    /** Occupies a port as an unrelated process would. */
    const occupy = () => new Promise<{ server: net.Server; port: number }>((resolve) => {
      const server = net.createServer((socket) => { socket.on('error', () => undefined); socket.end('unrelated'); }); openServers.push(server);
      server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as net.AddressInfo).port }));
    });
    const connects = (port: number) => new Promise<boolean>((resolve) => {
      const socket = net.connect(port, '127.0.0.1'); socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', () => resolve(false));
    });
    /** Fixture that publishes the port it listens on in a file, for liveness checks that do not depend on output parsing. */
    function serverFixture(name: string, script: string, body: string) {
      const dir = path.join(root, name); fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { dev: script } }));
      fs.writeFileSync(path.join(dir, 'server.cjs'), body);
      return { dir, posix: toPosixPath(dir), port: () => Number(fs.readFileSync(path.join(dir, 'port.txt'), 'utf8')) };
    }
    const listenAndRecord = `const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const server = http.createServer((_, response) => response.end('ok'));
server.listen(0, '127.0.0.1', () => { fs.writeFileSync(path.join(__dirname, 'port.txt'), String(server.address().port)); console.log('http://127.0.0.1:' + server.address().port + '/'); });
`;
    const attach = async (id: string, dir: string) => {
      const context = (await registry.registerCheckoutContext({ workspaceId: 'ws', path: dir, kind: 'worktree' })).checkoutContext!;
      terminals.set(id, { workspaceId: 'ws', checkoutContextId: context.id });
    };
    const settled = (id: string) => vi.waitFor(() => {
      const service = manager.snapshot().services.find((entry) => entry.sourceTerminalId === id)!;
      expect(['failed', 'stopped']).toContain(service.status);
      return service;
    }, { timeout: 15000 });

    it('terminates a server left alive when npm exits first, and says the service did not stop by itself', async () => {
      // The shell backgrounds the server and exits a moment later; npm (the PTY leader) follows. The server stays in the process group.
      const fixture = serverFixture('orphan', 'node server.cjs & sleep 1', listenAndRecord);
      await attach('orphan', fixture.posix);
      await start('orphan');
      await vi.waitFor(() => expect(fs.existsSync(path.join(fixture.dir, 'port.txt'))).toBe(true), { timeout: 10000 });
      const port = fixture.port();
      const service = await vi.waitFor(() => {
        const found = manager.snapshot().services.find((entry) => entry.sourceTerminalId === 'orphan')!;
        expect(found.status).toBe('failed');
        return found;
      }, { timeout: 15000 });
      expect(service.exitCode).toBe(0);
      expect(service.cleanupIncomplete).toBeUndefined();
      expect(service.error).toContain('exited on its own');
      expect(await connects(port)).toBe(false); // The surviving child was reaped, not just the parent.
      expect(manager.usages().filter((usage) => usage.checkoutContextId === terminals.get('orphan')!.checkoutContextId)).toEqual([]);
    }, 30000);

    it('Stop ends the whole npm → sh → node tree', async () => {
      const fixture = serverFixture('tree', 'node server.cjs', listenAndRecord);
      await attach('tree', fixture.posix);
      const started = await start('tree');
      await vi.waitFor(() => expect(fs.existsSync(path.join(fixture.dir, 'port.txt'))).toBe(true), { timeout: 10000 });
      const port = fixture.port();
      expect(await connects(port)).toBe(true);
      expect(await manager.stop('ws', started.service!.id)).toMatchObject({ success: true, service: { status: 'stopped' } });
      expect(await connects(port)).toBe(false);
    }, 30000);

    it('classifies a real EADDRINUSE failure and leaves the unrelated process using the port alone', async () => {
      const { port } = await occupy();
      const fixture = serverFixture('busy', 'node server.cjs', `require('node:http').createServer().listen(${port}, '127.0.0.1');\n`);
      await attach('busy', fixture.posix);
      await start('busy');
      const service = await settled('busy');
      expect(service).toMatchObject({ status: 'failed', exitCode: 1, portConflict: { port } });
      expect(service.error).toContain(`Port ${port} is already in use by another process. Clanker did not stop it.`);
      expect(service.error).toContain('EADDRINUSE');
      expect(await connects(port)).toBe(true); // Untouched.
    }, 30000);

    it('does not fail a server that reports a busy port and then successfully uses another one', async () => {
      const { port } = await occupy();
      const fixture = serverFixture('fallback', 'node server.cjs', `const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const server = http.createServer((_, response) => response.end('ok'));
server.once('error', () => { console.log('Port ${port} is in use, trying another one...'); server.listen(0, '127.0.0.1'); });
server.on('listening', () => { fs.writeFileSync(path.join(__dirname, 'port.txt'), String(server.address().port)); console.log('http://127.0.0.1:' + server.address().port + '/'); });
server.listen(${port}, '127.0.0.1');
`);
      await attach('fallback', fixture.posix);
      await start('fallback');
      const service = await vi.waitFor(() => {
        const found = manager.snapshot().services.find((entry) => entry.sourceTerminalId === 'fallback')!;
        expect(found.previewUrl).toBeTruthy();
        return found;
      }, { timeout: 15000 });
      expect(service).toMatchObject({ status: 'running' });
      expect(service.portConflict).toBeUndefined();
      expect(service.previewUrl).not.toContain(`:${port}/`);
      expect(await connects(port)).toBe(true);
    }, 30000);

    it('restarts a failed service in place once its script is fixed, leaving one service and no stray process', async () => {
      const fixture = serverFixture('flaky', 'node -e "console.error(\'compile error\'); process.exit(3)"', listenAndRecord);
      await attach('flaky', fixture.posix);
      const first = await start('flaky');
      expect((await settled('flaky')).error).toContain('compile error');
      fs.writeFileSync(path.join(fixture.dir, 'package.json'), JSON.stringify({ scripts: { dev: 'node server.cjs' } }));
      const second = await start('flaky');
      expect(second.success).toBe(true);
      expect(second.service!.id).not.toBe(first.service!.id);
      await vi.waitFor(() => expect(fs.existsSync(path.join(fixture.dir, 'port.txt'))).toBe(true), { timeout: 10000 });
      expect(manager.snapshot().services.filter((entry) => entry.sourceTerminalId === 'flaky')).toHaveLength(1);
      expect(await connects(fixture.port())).toBe(true);
      expect(await manager.stop('ws', second.service!.id)).toMatchObject({ success: true });
      expect(await connects(fixture.port())).toBe(false);
    }, 30000);

    it('stopping one worktree service leaves a sibling untouched, and closing the workspace ends both', async () => {
      const one = serverFixture('one', 'node server.cjs', listenAndRecord), two = serverFixture('two', 'node server.cjs', listenAndRecord);
      await attach('one', one.posix); await attach('two', two.posix);
      const first = await start('one'); await start('two');
      await vi.waitFor(() => expect(fs.existsSync(path.join(one.dir, 'port.txt')) && fs.existsSync(path.join(two.dir, 'port.txt'))).toBe(true), { timeout: 10000 });
      await manager.stop('ws', first.service!.id);
      expect(await connects(one.port())).toBe(false);
      expect(await connects(two.port())).toBe(true);
      await manager.closeWorkspace('ws');
      expect(await connects(two.port())).toBe(false);
    }, 30000);

    it('shutdown ends an active tree and refuses later launches', async () => {
      const fixture = serverFixture('quit', 'node server.cjs', listenAndRecord);
      await attach('quit', fixture.posix);
      const discovered = (await manager.discover({ workspaceId: 'ws', terminalId: 'quit' })).command!;
      await manager.start({ workspaceId: 'ws', terminalId: 'quit', checkoutContextId: discovered.checkoutContextId, cwd: discovered.cwd, command: discovered.command });
      await vi.waitFor(() => expect(fs.existsSync(path.join(fixture.dir, 'port.txt'))).toBe(true), { timeout: 10000 });
      await manager.shutdown();
      expect(await connects(fixture.port())).toBe(false);
      expect(await manager.start({ workspaceId: 'ws', terminalId: 'quit', checkoutContextId: discovered.checkoutContextId, cwd: discovered.cwd, command: discovered.command })).toMatchObject({ success: false });
    }, 30000);
  });
});
