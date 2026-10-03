// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeWorkspaceWithCleanup } from '../../../src/renderer/lib/workspaceClose';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import * as lifecycle from '../../../src/renderer/lib/workspaceLifecycle';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';

describe('closeWorkspaceWithCleanup', () => {
  let api: ReturnType<typeof installElectronApiMock>;
  let order: string[];

  beforeEach(() => {
    api = installElectronApiMock();
    order = [];
    vi.spyOn(lifecycle, 'disposeWorkspaceResources').mockImplementation(async () => { order.push('dispose'); });
    api.unregisterOpenWorkspace.mockImplementation(async () => { order.push('unregister'); });
    const closeWorkspace = vi.fn((id: string) => {
      order.push('close');
      useWorkspaceStore.setState((s) => ({ workspaces: s.workspaces.filter((w) => w.id !== id) }));
    });
    useWorkspaceStore.setState({
      workspaces: [
        createWorkspaceFixture({ id: 'a', lifecycle: 'active' }),
        createWorkspaceFixture({ id: 'b', lifecycle: 'parked' }),
      ],
      activeWorkspaceId: 'a',
      closeWorkspace,
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('disposes resources, then removes the renderer workspace, then unregisters', async () => {
    await closeWorkspaceWithCleanup('a');
    expect(order).toEqual(['dispose', 'close', 'unregister']);
    expect(lifecycle.disposeWorkspaceResources).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a' }), { isActiveWorkspace: true });
    expect(api.unregisterOpenWorkspace).toHaveBeenCalledWith('a');
  });

  it('marks an inactive workspace as not active when disposing', async () => {
    await closeWorkspaceWithCleanup('b');
    expect(lifecycle.disposeWorkspaceResources).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b' }), { isActiveWorkspace: false });
    expect(useWorkspaceStore.getState().workspaces.map((w) => w.id)).toEqual(['a']);
  });

  it('logs unregister failures without resurrecting the closed workspace', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    api.unregisterOpenWorkspace.mockRejectedValue(new Error('boom'));
    await expect(closeWorkspaceWithCleanup('b')).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith('Could not unregister closed workspace:', expect.any(Error));
    expect(useWorkspaceStore.getState().workspaces.map((w) => w.id)).toEqual(['a']);
  });

  it('does nothing for an unknown workspace', async () => {
    await closeWorkspaceWithCleanup('missing');
    expect(order).toEqual([]);
  });
});
