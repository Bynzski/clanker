import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useBrowserOverlaySuppression } from '../../../src/renderer/lib/useBrowserOverlaySuppression';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { WorkspaceScopeProvider } from '../../../src/renderer/components/WorkspaceScope';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';

const count = (id: string) => useWorkspaceStore.getState().workspaces.find((w) => w.id === id)?.browserOverlayCount;

beforeEach(() => {
  installElectronApiMock();
  useWorkspaceStore.setState({ workspaces: [createWorkspaceFixture({ id: 'a' }), createWorkspaceFixture({ id: 'b' })], activeWorkspaceId: 'a', browserOverlayCount: 0 });
});

describe('useBrowserOverlaySuppression', () => {
  it('balances close, reopen, rerender and unmount under StrictMode', () => {
    const { rerender, unmount } = renderHook(({ open }) => useBrowserOverlaySuppression(open), {
      initialProps: { open: false }, wrapper: StrictMode,
    });
    expect(count('a')).toBe(0);
    rerender({ open: true });
    rerender({ open: true });
    expect(count('a')).toBe(1);
    rerender({ open: false });
    expect(count('a')).toBe(0);
    rerender({ open: true });
    unmount();
    expect(count('a')).toBe(0);
  });

  it('keeps another owner suppressed when one overlay closes', () => {
    const first = renderHook(() => useBrowserOverlaySuppression(true));
    const second = renderHook(() => useBrowserOverlaySuppression(true));
    expect(count('a')).toBe(2);
    second.unmount();
    expect(count('a')).toBe(1);
    first.unmount();
    expect(count('a')).toBe(0);
  });

  it('transfers unscoped ownership on workspace switches without releasing another lease', () => {
    useWorkspaceStore.getState().pushBrowserOverlay('b');
    const { unmount } = renderHook(() => useBrowserOverlaySuppression(true));
    act(() => useWorkspaceStore.setState({ activeWorkspaceId: 'b' }));
    expect(count('a')).toBe(0);
    expect(count('b')).toBe(2);
    unmount();
    expect(count('b')).toBe(1);
  });

  it('respects context and explicit workspace scopes', () => {
    const contextual = renderHook(() => useBrowserOverlaySuppression(true), {
      wrapper: ({ children }) => <WorkspaceScopeProvider workspaceId="b">{children}</WorkspaceScopeProvider>,
    });
    const explicit = renderHook(() => useBrowserOverlaySuppression(true, 'a'), {
      wrapper: ({ children }) => <WorkspaceScopeProvider workspaceId="b">{children}</WorkspaceScopeProvider>,
    });
    expect(count('a')).toBe(1);
    expect(count('b')).toBe(1);
    contextual.unmount();
    explicit.unmount();
    expect(count('a')).toBe(0);
    expect(count('b')).toBe(0);
  });

  it('supports the no-workspace snapshot', () => {
    useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null });
    const { unmount } = renderHook(() => useBrowserOverlaySuppression(true));
    expect(useWorkspaceStore.getState().browserOverlayCount).toBe(1);
    unmount();
    expect(useWorkspaceStore.getState().browserOverlayCount).toBe(0);
  });

  it('does not release a new workspace owner when leaving the no-workspace snapshot', () => {
    useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null });
    const { unmount } = renderHook(() => useBrowserOverlaySuppression(true));
    act(() => useWorkspaceStore.setState({ workspaces: [createWorkspaceFixture({ id: 'a', browserOverlayCount: 1 })], activeWorkspaceId: 'a', browserOverlayCount: 1 }));
    expect(count('a')).toBe(2);
    unmount();
    expect(count('a')).toBe(1);
  });
  it('does not release another workspace after the owner workspace is removed', () => {
    const { unmount } = renderHook(() => useBrowserOverlaySuppression(true, 'a'));
    act(() => useWorkspaceStore.setState({ workspaces: [createWorkspaceFixture({ id: 'b', browserOverlayCount: 1 })], activeWorkspaceId: 'b', browserOverlayCount: 1 }));
    unmount();
    expect(count('b')).toBe(1);
    expect(useWorkspaceStore.getState().browserOverlayCount).toBe(1);
  });

  it('does not acquire suppression for an explicitly missing workspace', () => {
    const { unmount } = renderHook(() => useBrowserOverlaySuppression(true, 'missing'));
    expect(count('a')).toBe(0);
    expect(useWorkspaceStore.getState().browserOverlayCount).toBe(0);
    unmount();
  });

});
