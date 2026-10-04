import { describe, expect, it, vi } from 'vitest';
import type { GitWorktreeListResult } from '../../../src/shared/types/git';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';
import type { RegisteredWorkspace, WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import { findHarnessProvider } from '../../../src/main/harnesses/registry';
import { worktreeDirectoryName } from '../../../src/main/worktreePaths';
import { WorktreeProvenance } from '../../../src/main/worktreeProvenance';
import { collectSessionCheckoutPlan, recordListedWorktrees, type SessionCheckoutPlan } from '../../../src/main/sessionWorktrees';
import { resolveSessionResumeTarget } from '../../../src/main/sessionResumeTarget';

const workspace = { workspaceId: 'ws', location: { environmentId: 'ssh-a', path: '/p/app' } } as unknown as RegisteredWorkspace;
const main: CheckoutContext = { id: 'ws::main', workspaceId: 'ws', environmentId: 'ssh-a', path: '/p/app', kind: 'main' };
const generated = (branch: string) => `/p/app-worktrees/${worktreeDirectoryName(branch)}`;
const entry = (p: string, branch: string | null, extra: Partial<GitWorktreeListResult['worktrees'][number]> = {}) =>
  ({ path: p, branch, isMain: false, isLocked: false, isPrunable: false, ...extra });

function setup(options: { contexts?: CheckoutContext[]; worktrees?: GitWorktreeListResult['worktrees']; branches?: string[]; provenance?: WorktreeProvenance } = {}) {
  const contexts = [main, ...(options.contexts ?? [])];
  const registerCheckoutContext = vi.fn(async (request: { path: string; branch?: string }) => {
    const context: CheckoutContext = { id: 'ws::adopted', workspaceId: 'ws', environmentId: 'ssh-a', path: request.path, kind: 'worktree', branch: request.branch };
    contexts.push(context);
    return { success: true, checkoutContext: context };
  });
  const registry = {
    getWorkspace: (id: string) => id === 'ws' ? workspace : null,
    getCheckoutContextsForWorkspace: () => contexts,
    registerCheckoutContext,
  } as unknown as WorkspaceRegistry;
  const worktrees = options.worktrees ?? [entry('/p/app', 'main', { isMain: true })];
  const listWorktrees = async (): Promise<GitWorktreeListResult> => ({ success: true, worktrees });
  const plan = (): Promise<SessionCheckoutPlan> => collectSessionCheckoutPlan({
    registry, workspace, listWorktrees, listBranches: async () => options.branches ?? [], provenance: options.provenance,
  });
  return { registry, registerCheckoutContext, listWorktrees, plan };
}

describe('harness removed-worktree resume policy', () => {
  // Characterized with isolated homes and the installed CLIs (docs/harness-integration.md "Removed-worktree resume").
  it.each([
    ['claude', true], ['codex', true], ['omp', true], ['pi', false], ['opencode', false], ['agy', false],
  ] as const)('%s resumes from another directory: %s', (harness, portable) => {
    expect(findHarnessProvider(harness)?.sessions?.resumesWithoutOriginalDirectory === true).toBe(portable);
  });
});

describe('resolveSessionResumeTarget', () => {
  it('resumes ordinary sessions in the main checkout and refuses anything outside', async () => {
    const t = setup();
    const params = { registry: t.registry, workspace, plan: await t.plan(), harness: 'codex', mainContext: main };
    expect(await resolveSessionResumeTarget({ ...params, cwd: '/p/app/src' })).toEqual({ kind: 'launch', target: 'main', context: main });
    await expect(resolveSessionResumeTarget({ ...params, cwd: '/p/app-worktrees/random-folder' })).rejects.toThrow('outside the workspace');
  });

  it('resumes into the registered context of a live worktree', async () => {
    const context: CheckoutContext = { id: 'ws::wt', workspaceId: 'ws', environmentId: 'ssh-a', path: generated('live'), kind: 'worktree', branch: 'live' };
    const t = setup({ contexts: [context], worktrees: [entry('/p/app', 'main', { isMain: true }), entry(generated('live'), 'live')] });
    const result = await resolveSessionResumeTarget({ registry: t.registry, workspace, plan: await t.plan(), harness: 'pi', cwd: `${generated('live')}/src`, mainContext: main });
    expect(result).toEqual({ kind: 'launch', target: 'worktree', context });
    expect(t.registerCheckoutContext).not.toHaveBeenCalled();
  });

  it('adopts an unmanaged live worktree through Git\'s listing', async () => {
    const t = setup({ worktrees: [entry('/p/app', 'main', { isMain: true }), entry('/p/app-sib', 'sib')] });
    const result = await resolveSessionResumeTarget({
      registry: t.registry, workspace, plan: await t.plan(), harness: 'opencode', cwd: '/p/app-sib', mainContext: main, listWorktrees: t.listWorktrees,
    });
    expect(t.registerCheckoutContext).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws', kind: 'worktree', path: '/p/app-sib' }));
    expect(result).toMatchObject({ kind: 'launch', target: 'worktree', context: { id: 'ws::adopted' } });
  });

  describe('a live worktree that cannot be adopted (locked)', () => {
    const locked = [entry('/p/app', 'main', { isMain: true }), entry('/p/app-sib', 'sib', { isLocked: true })];
    it('resumes a portable harness in main and says why', async () => {
      const t = setup({ worktrees: locked });
      const result = await resolveSessionResumeTarget({
        registry: t.registry, workspace, plan: await t.plan(), harness: 'claude', cwd: '/p/app-sib', mainContext: main, listWorktrees: t.listWorktrees,
      });
      expect(result).toMatchObject({ kind: 'launch', target: 'main', context: main, notice: expect.stringMatching(/sib.*could not be used.*locked.*main checkout/) });
    });
    it('never substitutes main for a harness that only resumes in its own directory', async () => {
      const t = setup({ worktrees: locked });
      await expect(resolveSessionResumeTarget({
        registry: t.registry, workspace, plan: await t.plan(), harness: 'pi', cwd: '/p/app-sib', mainContext: main, listWorktrees: t.listWorktrees,
      })).rejects.toThrow(/Pi can only resume in the directory it started in/);
    });
  });

  describe('a removed worktree', () => {
    const base = { worktrees: [entry('/p/app', 'main', { isMain: true })], branches: ['main', 'feature/foo'] };

    it.each(['claude', 'codex', 'omp'])('resumes %s in the main checkout with an explicit notice naming the branch', async (harness) => {
      const t = setup(base);
      const result = await resolveSessionResumeTarget({
        registry: t.registry, workspace, plan: await t.plan(), harness, cwd: `${generated('feature/foo')}/src`, mainContext: main,
      });
      expect(result).toEqual({
        kind: 'launch', target: 'main', context: main,
        notice: 'The worktree this conversation ran in (feature/foo) was removed, so it resumed in the main checkout.',
      });
    });

    it.each(['pi', 'opencode', 'agy'])('offers to recreate the worktree for %s and creates nothing yet', async (harness) => {
      const t = setup(base);
      const recreateWorktree = vi.fn();
      const confirmSession = vi.fn().mockResolvedValue(true);
      const result = await resolveSessionResumeTarget({
        registry: t.registry, workspace, plan: await t.plan(), harness, cwd: `${generated('feature/foo')}/src`, mainContext: main, recreateWorktree, confirmSession,
      });
      expect(result).toEqual({ kind: 'offer', offer: { branch: 'feature/foo', path: generated('feature/foo') } });
      expect(confirmSession).toHaveBeenCalledTimes(1);
      expect(recreateWorktree).not.toHaveBeenCalled();
    });

    it('recreates at the original generated path only when confirmed, then resumes into the new context', async () => {
      const t = setup(base);
      const created: CheckoutContext = { id: 'ws::re', workspaceId: 'ws', environmentId: 'ssh-a', path: generated('feature/foo'), kind: 'worktree', branch: 'feature/foo' };
      const recreateWorktree = vi.fn().mockResolvedValue({ success: true, worktree: { path: generated('feature/foo'), branch: 'feature/foo', isMain: false, isLocked: false, isPrunable: false }, checkoutContext: created });
      const result = await resolveSessionResumeTarget({
        registry: t.registry, workspace, plan: await t.plan(), harness: 'pi', cwd: `${generated('feature/foo')}/src`, mainContext: main,
        recreateWorktree, recreateRequested: true, confirmSession: async () => true,
      });
      expect(recreateWorktree).toHaveBeenCalledExactlyOnceWith('feature/foo');
      expect(result).toEqual({ kind: 'launch', target: 'worktree', context: created, notice: 'Recreated the worktree for feature/foo and resumed there.' });
    });

    it('refuses a recreation that lands anywhere but the original path or fails', async () => {
      const t = setup(base);
      const params = {
        registry: t.registry, workspace, harness: 'pi', cwd: generated('feature/foo'), mainContext: main, recreateRequested: true, confirmSession: async () => true,
      };
      const wrong: CheckoutContext = { id: 'ws::re', workspaceId: 'ws', environmentId: 'ssh-a', path: '/p/app-worktrees/elsewhere', kind: 'worktree' };
      await expect(resolveSessionResumeTarget({
        ...params, plan: await t.plan(),
        recreateWorktree: async () => ({ success: true, worktree: { path: '/p/app-worktrees/elsewhere', branch: 'feature/foo', isMain: false, isLocked: false, isPrunable: false }, checkoutContext: wrong }),
      })).rejects.toThrow(/could not be recreated at its original location/);
      await expect(resolveSessionResumeTarget({
        ...params, plan: await t.plan(), recreateWorktree: async () => ({ success: false, error: 'Branch feature/foo already has a worktree' }),
      })).rejects.toThrow('already has a worktree');
    });

    it('never offers or creates anything for a conversation main cannot find itself', async () => {
      const t = setup(base);
      const recreateWorktree = vi.fn();
      await expect(resolveSessionResumeTarget({
        registry: t.registry, workspace, plan: await t.plan(), harness: 'pi', cwd: generated('feature/foo'), mainContext: main,
        recreateWorktree, recreateRequested: true, confirmSession: async () => false,
      })).rejects.toThrow('Session was not found');
      expect(recreateWorktree).not.toHaveBeenCalled();
    });

    it('states precisely why a deleted branch cannot be recreated', async () => {
      const provenance = new WorktreeProvenance({ read: () => [], write: () => undefined });
      recordListedWorktrees(provenance, 'ssh-a', { success: true, worktrees: [entry('/p/app', 'main', { isMain: true }), entry(generated('feature/gone'), 'feature/gone')] });
      const t = setup({ ...base, branches: ['main'], provenance });
      await expect(resolveSessionResumeTarget({
        registry: t.registry, workspace, plan: await t.plan(), harness: 'opencode', cwd: generated('feature/gone'), mainContext: main,
      })).rejects.toThrow(/feature\/gone, but that worktree was removed and its branch "feature\/gone" no longer exists.*OpenCode can only resume in the directory it started in/);
    });

    it('does not recreate an adopted sibling it did not generate', async () => {
      const provenance = new WorktreeProvenance({ read: () => [], write: () => undefined });
      recordListedWorktrees(provenance, 'ssh-a', { success: true, worktrees: [entry('/p/app', 'main', { isMain: true }), entry('/p/app-sib', 'sib')] });
      const t = setup({ ...base, branches: ['main', 'sib'], provenance });
      await expect(resolveSessionResumeTarget({
        registry: t.registry, workspace, plan: await t.plan(), harness: 'agy', cwd: '/p/app-sib/src', mainContext: main,
      })).rejects.toThrow(/was not one Clanker generated.*Antigravity can only resume/);
    });
  });
});
