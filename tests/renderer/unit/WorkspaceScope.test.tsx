// @vitest-environment jsdom

import { Profiler } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  useScopedWorkspace,
  useScopedWorkspaceActivity,
} from '../../../src/renderer/components/WorkspaceScope';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture } from '../../setup/fixtures';

afterEach(() => cleanup());

describe('WorkspaceScope selectors', () => {
  it('does not rerender a scoped surface when a different workspace changes', () => {
    const workspaceOne = createWorkspaceFixture({ id: 'workspace-1', lifecycle: 'active' });
    const workspaceTwo = createWorkspaceFixture({ id: 'workspace-2', lifecycle: 'parked' });
    useWorkspaceStore.setState({
      workspaces: [workspaceOne, workspaceTwo],
      activeWorkspaceId: workspaceOne.id,
      activeWorkspaceLifecycle: 'active',
    });
    const onRender = vi.fn();

    function ScopedConsumer() {
      const workspace = useScopedWorkspace(workspaceOne.id);
      const active = useScopedWorkspaceActivity(workspaceOne.id);
      return <div>{workspace?.name}:{String(active)}</div>;
    }

    render(
      <Profiler id="scoped-workspace" onRender={onRender}>
        <ScopedConsumer />
      </Profiler>,
    );
    expect(screen.getByText(`${workspaceOne.name}:true`)).toBeTruthy();
    expect(onRender).toHaveBeenCalledTimes(1);

    act(() => {
      useWorkspaceStore.setState({
        workspaces: [workspaceOne, { ...workspaceTwo, name: 'Changed elsewhere' }],
      });
    });

    expect(onRender).toHaveBeenCalledTimes(1);
  });
});
