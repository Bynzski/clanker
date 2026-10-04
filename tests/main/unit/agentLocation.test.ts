import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalAgentLocation, createAgentLocationResolver, locateCheckoutContext, MAX_AGENT_LOCATION_BYTES } from '../../../src/main/agentLocation';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';
import { OBSERVER_FIELDS } from '../../../src/main/harnesses/attentionSources';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const tempDir = () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-location-')));
  dirs.push(dir);
  return dir;
};

describe('canonicalAgentLocation', () => {
  it('reports a local directory in the registry\'s canonical form: resolved, POSIX, no trailing slash', () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, 'repo'));

    expect(canonicalAgentLocation(`${dir}${path.sep}repo${path.sep}.${path.sep}sub${path.sep}..${path.sep}`, 'local')).toBe(`${dir.replace(/\\/g, '/')}/repo`);
  });

  it('keeps the normalized reported path of a local directory that no longer exists', () => {
    const dir = tempDir();
    const removed = path.join(dir, 'worktrees', 'wt-1');

    expect(canonicalAgentLocation(`${removed}${path.sep}`, 'local')).toBe(removed.replace(/\\/g, '/'));
  });

  it('converts a Windows-reported local path to the canonical forward-slash form', () => {
    expect(canonicalAgentLocation('C:\\Users\\Jane Doe\\repo\\', 'local', 'win32')).toBe('C:/Users/Jane Doe/repo');
  });

  it('normalizes a host path for remote agents without touching the desktop filesystem', () => {
    expect(canonicalAgentLocation('/srv/app/./wt/../main/', 'remote')).toBe('/srv/app/main');
    expect(canonicalAgentLocation('/', 'remote')).toBe('/');
  });

  it('rejects relative, empty, non-string, control-character and oversized reports', () => {
    for (const transport of ['local', 'remote'] as const) {
      for (const bad of ['', 'relative/dir', './x', 42, null, undefined, '/srv/a\nb', '/srv/a\u0007b', `/${'a'.repeat(MAX_AGENT_LOCATION_BYTES)}`]) {
        expect(canonicalAgentLocation(bad, transport)).toBeNull();
      }
    }
    expect(canonicalAgentLocation('C:\\repo', 'remote')).toBeNull();
  });
});

describe('locateCheckoutContext', () => {
  const ctx = (id: string, root: string, kind: CheckoutContext['kind'] = 'worktree', environmentId = 'local'): CheckoutContext =>
    ({ id, workspaceId: 'ws', environmentId, path: root, kind });

  it('picks the most specific registered root containing the location', () => {
    const dir = tempDir();
    const main = `${dir}/repo`.replace(/\\/g, '/');
    const nested = `${main}/.claude/worktrees/wt`;
    const sibling = `${dir}/repo-worktrees/wt-1`.replace(/\\/g, '/');
    for (const root of [nested, sibling]) fs.mkdirSync(root, { recursive: true });
    const contexts = [ctx('ws::main', main, 'main'), ctx('ws::nested', nested), ctx('ws::sibling', sibling)];

    expect(locateCheckoutContext(`${main}/src`, contexts, 'local')?.id).toBe('ws::main');
    expect(locateCheckoutContext(`${nested}/a`, contexts, 'local')?.id).toBe('ws::nested');
    expect(locateCheckoutContext(sibling, contexts, 'local')?.id).toBe('ws::sibling');
    expect(locateCheckoutContext(`${main}-other`, contexts, 'local')).toBeNull();
    expect(locateCheckoutContext(dir.replace(/\\/g, '/'), contexts, 'local')).toBeNull();
  });

  it.skipIf(process.platform === 'win32')('matches through symlinks on either side of a local comparison', () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, 'real', 'repo'), { recursive: true });
    fs.symlinkSync(path.join(dir, 'real'), path.join(dir, 'link'));
    const contexts = [ctx('ws::main', `${dir}/link/repo`, 'main')];

    // The agent reports its physical directory while the workspace was opened through a symlink.
    expect(locateCheckoutContext(`${dir}/real/repo/sub`, contexts, 'local')?.id).toBe('ws::main');
  });

  it('still maps a removed local directory to the registered root it was under', () => {
    const dir = tempDir().replace(/\\/g, '/');
    const removed = `${dir}/repo-worktrees/wt-1`;
    expect(locateCheckoutContext(removed, [ctx('ws::wt', removed)], 'local')?.id).toBe('ws::wt');
  });

  it('compares remote host paths lexically', () => {
    const contexts = [ctx('ws::main', '/srv/app', 'main', 'ssh-1'), ctx('ws::wt', '/srv/app-worktrees/x', 'worktree', 'ssh-1')];
    expect(locateCheckoutContext('/srv/app/lib', contexts, 'remote')?.id).toBe('ws::main');
    expect(locateCheckoutContext('/srv/app-worktrees/x', contexts, 'remote')?.id).toBe('ws::wt');
    expect(locateCheckoutContext('/srv/application', contexts, 'remote')).toBeNull();
  });
});

describe('createAgentLocationResolver', () => {
  const contexts: CheckoutContext[] = [
    { id: 'ws::main', workspaceId: 'ws', environmentId: 'ssh-1', path: '/srv/repo', kind: 'main' },
    { id: 'ws::wt', workspaceId: 'ws', environmentId: 'ssh-1', path: '/srv/repo-worktrees/wt-1', kind: 'worktree' },
  ];
  const resolver = createAgentLocationResolver({
    getTerminal: (id) => ({ agent: { workspaceId: 'ws' }, loose: {} } as Record<string, { workspaceId?: string }>)[id],
    getCheckoutContexts: (workspaceId) => (workspaceId === 'ws' ? contexts : []),
  });

  it('resolves only against the contexts of the reporting terminal\'s own workspace', () => {
    expect(resolver('agent', 'remote', '/srv/repo-worktrees/wt-1/src')).toEqual({ path: '/srv/repo-worktrees/wt-1/src', checkoutContextId: 'ws::wt' });
    expect(resolver('agent', 'remote', '/srv/repo/')).toEqual({ path: '/srv/repo', checkoutContextId: 'ws::main' });
    expect(resolver('agent', 'remote', '/tmp')).toEqual({ path: '/tmp', checkoutContextId: null });
    expect(resolver('loose', 'remote', '/srv/repo')).toEqual({ path: '/srv/repo', checkoutContextId: null });
    expect(resolver('gone', 'remote', '/srv/repo')).toEqual({ path: '/srv/repo', checkoutContextId: null });
    expect(resolver('agent', 'remote', 'relative')).toBeNull();
  });
});

describe('attention envelope location', () => {
  async function envelope() {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'envelope.mjs'), `${OBSERVER_FIELDS}\nexport { envelope };\n`);
    return (await import(/* @vite-ignore */ pathToFileURL(path.join(dir, 'envelope.mjs')).href)).envelope as (event: string, fields: object) => Record<string, unknown>;
  }

  it('forwards a bounded working directory and nothing else from the hook payload', async () => {
    const wrap = await envelope();
    expect(wrap('location_changed', { sessionId: 's', scope: 'root', cwd: '/home/u/repo', prompt: 'secret' }))
      .toEqual({ event: 'location_changed', sessionId: 's', scope: 'root', cwd: '/home/u/repo' });
  });

  it('drops an oversized or control-character directory but still delivers the lifecycle event', async () => {
    const wrap = await envelope();
    for (const cwd of [`/${'a'.repeat(MAX_AGENT_LOCATION_BYTES)}`, '/a\nb', '', 7]) {
      expect(wrap('turn_completed', { sessionId: 's', turnId: 't', scope: 'root', cwd })).toEqual({ event: 'turn_completed', sessionId: 's', turnId: 't', scope: 'root' });
    }
  });
});
