// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { WorkspacePageSwitcher } from '../../../src/renderer/components/WorkspacePageControls';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';
const drag = vi.hoisted(() => ({ active: null as { data: { current: unknown } } | null, over: '',
  targets: new Map<string, { disabled: boolean; data: unknown }>() }));
vi.mock('../../../src/renderer/components/WorkspacePaneDragProvider', () => ({ useSharedPaneDrag: () => true }));
vi.mock('@dnd-kit/core', () => ({
  useDndContext: () => ({ active: drag.active }),
  useDroppable: (options: { id: string; disabled: boolean; data: unknown }) => {
    drag.targets.set(options.id, options);
    return { setNodeRef: () => {}, isOver: options.id === drag.over };
  },
  closestCorners: vi.fn(() => []), pointerWithin: vi.fn(() => []),
}));
const store = () => useWorkspaceStore.getState();
const workspace = () => store().getWorkspaceById('w')!;
beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true); installElectronApiMock();
  drag.active = null; drag.over = ''; drag.targets.clear();
  store().addWorkspace(createWorkspaceFixture({ id: 'w', terminals: [{ id: 't1', pid: 1, workingDir: '/workspace' }], panes: [{ id: 'p1', terminalId: 't1' }] }));
});
afterEach(cleanup);
function actor(workspaceId = 'w', pageId = workspace().activePageId) {
  drag.active = { data: { current: { workspaceId, pageId, paneId: 'p1' } } };
}
describe('footer page drop targets', () => {
  it('highlights only a current same-workspace drag and supplies the exact destination identity', () => {
    const source = workspace().activePageId!;
    store().addWorkspacePage('w'); const target = workspace().activePageId!;
    store().selectWorkspacePage('w', source); actor();
    drag.over = `workspace-page-drop-w-${target}`;
    render(<WorkspacePageSwitcher workspace={workspace()} />);
    expect(screen.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Page 2' })).toHaveClass('page-drop-valid', 'page-drop-over');
    expect(drag.targets.get(drag.over)).toMatchObject({ disabled: false, data: { intent: { kind: 'workspace-page', workspaceId: 'w', pageId: target } } });
    expect(screen.getByRole('button', { name: 'Add page' })).toHaveClass('page-drop-valid');
  });
  it.each(['foreign', 'stale', 'no-drag'])('does not advertise targets for %s actors', (kind) => {
    if (kind !== 'no-drag') actor(kind === 'foreign' ? 'another-workspace' : 'w', kind === 'stale' ? 'old-page' : workspace().activePageId);
    render(<WorkspacePageSwitcher workspace={workspace()} />);
    expect(screen.getByRole('button', { name: 'Add page' })).not.toHaveClass('page-drop-valid');
    expect([...drag.targets.values()].every(target => target.disabled)).toBe(true);
  });
  it('disables + dropping at nine pages without enlarging or adding targets', () => {
    const source = workspace().activePageId!;
    while (workspace().pages!.length < 9) store().addWorkspacePage('w');
    store().selectWorkspacePage('w', source); actor();
    render(<WorkspacePageSwitcher workspace={workspace()} />);
    expect(screen.getByRole('button', { name: 'Add page' })).toBeDisabled();
    expect(drag.targets.get('workspace-page-drop-w-new')?.disabled).toBe(true);
    expect(drag.targets.size).toBe(10);
  });
});
