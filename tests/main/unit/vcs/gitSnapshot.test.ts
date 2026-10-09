import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitService } from '../../../../src/main/gitService';
const SHA = 'a'.repeat(40);
let service: GitService; let upstream: string; let head: string; let remotes: string[];
const executor = vi.fn<(path: string, args: string[], timeout: number | undefined, id?: string, environment?: string, context?: string) => Promise<{ stdout: string; stderr: string }>>();
beforeEach(() => {
  upstream = 'upstream'; head = 'feature/topic'; remotes = ['origin', 'upstream']; executor.mockReset();
  executor.mockImplementation(async (_path, args) => ({ stderr: '', stdout: args.includes('status') ? `# branch.oid ${SHA}\n# branch.head ${head}\n`
    : args[0] === 'for-each-ref' ? `${upstream}\n` : remotes.map((name) => `${name}\thttps://github.com/${name}/repo.git (fetch)\n${name}\thttps://github.com/${name}/repo.git (push)`).join('\n') }));
  service = new GitService(() => {}); service.setGitExecutor(executor);
});
describe('GitService authoritative VCS snapshot', () => {
  it('uses upstream remote rather than the first remote, with actual checkout HEAD', async () => {
    expect(await service.getVcsSnapshot('/repo')).toEqual({ sha: SHA, branch: head, remoteName: 'upstream', remoteUrl: 'https://github.com/upstream/repo.git' });
  });
  it('has deterministic origin/single-remote fallback and refuses ambiguous or missing upstream', async () => {
    upstream = ''; expect((await service.getVcsSnapshot('/repo'))?.remoteName).toBe('origin');
    remotes = ['first', 'second']; expect((await service.getVcsSnapshot('/repo'))?.remoteName).toBeNull();
    remotes = ['only']; expect((await service.getVcsSnapshot('/repo'))?.remoteName).toBe('only');
    upstream = 'missing'; expect((await service.getVcsSnapshot('/repo'))?.remoteName).toBeNull();
  });
  it('keeps detached HEAD explicit', async () => {
    head = '(detached)'; expect(await service.getVcsSnapshot('/repo')).toMatchObject({ sha: SHA, branch: null, remoteName: 'origin' });
    expect(executor.mock.calls.some(([, args]) => args[0] === 'for-each-ref')).toBe(false);
  });
  it('executes through scoped SSH checkout identity, preserving root confinement and bounded metadata time', async () => {
    await service.withWorkspace({ workspaceId: 'ws', environmentId: 'ssh:host', checkoutContextId: 'isolated', workspacePath: '/repo-worktrees/topic' }, () => service.getVcsSnapshot('/repo-worktrees/topic'));
    for (const [path, , timeout, id, env, context] of executor.mock.calls) {
      expect([path, id, env, context]).toEqual(['/repo-worktrees/topic', 'ws', 'ssh:host', 'isolated']); expect(timeout).toBeGreaterThan(0); expect(timeout).toBeLessThanOrEqual(4000);
    }
    expect(executor.mock.calls[0][1]).toContain('--no-optional-locks');
    expect(service.getScopedWorkspaceIdentity()).toBeUndefined();
  });
  it('fails unknown on unborn commits and Git failures instead of guessing a branch', async () => {
    executor.mockResolvedValue({ stdout: '# branch.oid (initial)\n# branch.head main\n', stderr: '' }); expect(await service.getVcsSnapshot('/repo')).toBeNull();
    executor.mockRejectedValue(new Error('private remote credential')); expect(await service.getVcsSnapshot('/repo')).toBeNull();
  });
});
