// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { launchIsolatedAgent } from '../../../src/renderer/lib/isolatedAgentLaunch';
import { useWorkspaceStore, validateWorkspaceConsistency } from '../../../src/renderer/store/workspaceStore';
import { useAssistantNavStore } from '../../../src/renderer/store/assistantNavStore';
import { collectLeafPaneIds } from '../../../src/renderer/store/workspaceLayout';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';

const store = () => useWorkspaceStore.getState();
const workspace = () => store().getWorkspaceById('w')!;
const request = { workspaceId: 'w', harnessId: 'codex', visibleHarnessIds: ['codex'] };

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useAssistantNavStore.setState({ activeAssistantId: null });
  installElectronApiMock({
    gitGetBranchState: vi.fn().mockResolvedValue({ success: true, isRepo: true, currentBranch: 'main', isDetached: false, branches: [] }),
    spawnTerminal: vi.fn().mockImplementation(async (_cwd, _harness, _model, _command, _recipe, _workspace, _environment, checkoutContextId) =>
      ({ id: 'agent', pid: 42, checkoutContextId, harnessId: 'codex' })),
  });
});

function open(environmentId: string) {
  store().addWorkspace(createWorkspaceFixture({ id: 'w', workspacePath: '/repo', environmentId, gitIsRepo: true,
    terminals: [], panes: [], activeTerminalId: null }));
  return workspace().activePageId!;
}
function context(environmentId: string): CheckoutContext {
  return { id: 'w::isolated', workspaceId: 'w', environmentId, kind: 'worktree', path: '/repo-worktrees/task', branch: 'task', mainCheckoutPath: '/repo' };
}
function pendingResolution(operation: 'create' | 'adopt', checkoutContext: CheckoutContext) {
  let finish!: () => void;
  if (operation === 'create') {
    vi.mocked(window.electronAPI.gitCreateWorktree).mockReturnValue(new Promise(resolve => {
      finish = () => resolve({ success: true, checkoutContext,
        worktree: { path: checkoutContext.path, branch: 'task', isMain: false, isLocked: false, isPrunable: false } });
    }));
  } else {
    vi.mocked(window.electronAPI.adoptWorktreeCheckoutContext).mockReturnValue(new Promise(resolve => {
      finish = () => resolve({ success: true, checkoutContext });
    }));
  }
  const pending = launchIsolatedAgent({ ...request, target: operation === 'create'
    ? { kind: 'new-branch', branch: 'task' } : { kind: 'worktree', path: checkoutContext.path } });
  return { pending, finish: () => finish(), invoked: operation === 'create'
    ? window.electronAPI.gitCreateWorktree : window.electronAPI.adoptWorktreeCheckoutContext };
}

describe('isolated-agent page capture during checkout resolution', () => {
  for (const environmentId of ['local', 'ssh-slow']) for (const operation of ['create', 'adopt'] as const) {
    it(`${environmentId}: ${operation} finishes on the original inactive page without changing visible focus`, async () => {
      const pageId = open(environmentId);
      const checkoutContext = context(environmentId);
      const resolution = pendingResolution(operation, checkoutContext);
      await waitFor(() => expect(resolution.invoked).toHaveBeenCalledTimes(1));
      store().addWorkspacePage('w');
      const selected = workspace().activePageId;
      store().addTerminal({ id: 'visible', pid: 1, workingDir: '/repo' }, 'w');
      await store().openFileInEditor('/repo/test.ts', 'w');
      store().setActiveEditorTab(workspace().editorTabs[0].id, 'w');
      const visibleRoot = workspace().layoutRoot;
      const revision = workspace().layoutRevision;
      const fileFocus = workspace().fileSurfaceContextId;
      expect(fileFocus).toBe('w::main');
      let reservedPaneId: string | undefined;
      vi.mocked(window.electronAPI.spawnTerminal).mockImplementationOnce(async () => {
        // Reservation exists on the captured page before IPC, even while another page is active.
        reservedPaneId = collectLeafPaneIds(workspace().pages!.find(page => page.id === pageId)!.layoutRoot)[0];
        expect(reservedPaneId).toBeTruthy();
        expect(workspace().activePageId).toBe(selected);
        expect(workspace().layoutRoot).toBe(visibleRoot);
        expect(workspace().panes.find(pane => pane.id === reservedPaneId)?.terminalId).toBeNull();
        return { id: 'agent', pid: 42, checkoutContextId: checkoutContext.id, harnessId: 'codex' };
      });
      resolution.finish();
      expect(await resolution.pending).toEqual({ ok: true });
      expect(workspace().activePageId).toBe(selected);
      expect(workspace().layoutRoot).toBe(visibleRoot);
      expect(workspace().layoutRevision).toBe(revision);
      expect(workspace().activeTerminalId).toBe('visible');
      expect(workspace().fileSurfaceContextId).toBe(fileFocus);
      expect(store().activeTerminalId).toBe('visible');
      expect(collectLeafPaneIds(workspace().pages!.find(page => page.id === pageId)!.layoutRoot)).toEqual([reservedPaneId]);
      expect(workspace().panes.find(pane => pane.terminalId === 'agent')?.id).toBe(reservedPaneId);
      expect(workspace().terminals.find(terminal => terminal.id === 'agent')?.checkoutContextId).toBe(checkoutContext.id);
      expect(window.electronAPI.killTerminal).not.toHaveBeenCalled();
      expect(validateWorkspaceConsistency(store())).toEqual([]);
    });
    it(`${environmentId}: ${operation} cleans a failed off-page spawn reservation without changing selected-page history`, async () => {
      const pageId = open(environmentId);
      const resolution = pendingResolution(operation, context(environmentId));
      await waitFor(() => expect(resolution.invoked).toHaveBeenCalledTimes(1));
      store().addWorkspacePage('w');
      store().addTerminal({ id: 'visible', pid: 1, workingDir: '/repo' }, 'w');
      const selected = workspace().activePageId;
      const visibleRoot = workspace().layoutRoot;
      const revision = workspace().layoutRevision;
      vi.mocked(window.electronAPI.spawnTerminal).mockRejectedValueOnce(new Error('SSH startup failed'));
      resolution.finish();
      expect(await resolution.pending).toMatchObject({ ok: false, checkoutCreated: operation === 'create' });
      expect(window.electronAPI.spawnTerminal).toHaveBeenCalledTimes(1);
      expect(workspace().activePageId).toBe(selected);
      expect(workspace().layoutRoot).toBe(visibleRoot);
      expect(workspace().layoutRevision).toBe(revision);
      expect(workspace().activeTerminalId).toBe('visible');
      expect(workspace().pages!.find(page => page.id === pageId)!.layoutRoot).toBeNull();
      expect(workspace().panes.map(pane => pane.terminalId)).toEqual(['visible']);
      expect(validateWorkspaceConsistency(store())).toEqual([]);
    });
    it(`${environmentId}: ${operation} retains the checkout but refuses a destination page deleted while awaiting Git`, async () => {
      const pageId = open(environmentId);
      const checkoutContext = context(environmentId);
      const resolution = pendingResolution(operation, checkoutContext);
      await waitFor(() => expect(resolution.invoked).toHaveBeenCalledTimes(1));
      store().addWorkspacePage('w');
      const selected = workspace().activePageId;
      store().removeWorkspacePage('w', pageId);
      resolution.finish();
      expect(await resolution.pending).toMatchObject({ ok: false, checkoutCreated: operation === 'create' });
      expect(workspace().activePageId).toBe(selected);
      expect(workspace().checkoutContexts).toContainEqual(checkoutContext);
      expect(workspace().panes).toEqual([]);
      expect(window.electronAPI.spawnTerminal).not.toHaveBeenCalled();
      expect(window.electronAPI.releaseCheckoutContext).not.toHaveBeenCalled();
      expect(validateWorkspaceConsistency(store())).toEqual([]);
    });
  }
});
