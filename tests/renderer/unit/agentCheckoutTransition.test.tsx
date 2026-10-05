// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';
import type { AgentCheckoutTransitionEvent } from '../../../src/shared/types/checkoutTransition';
import { mainCheckoutContextId } from '../../../src/shared/checkoutContext';
import { createTerminalFixture, createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';

const { markTerminalDisposed } = vi.hoisted(() => ({ markTerminalDisposed: vi.fn() }));
vi.mock('../../../src/renderer/components/TerminalPane', () => ({
  markTerminalDisposed,
  writeCachedTerminalData: vi.fn(),
  writeCachedTerminalExit: vi.fn(),
}));

import StatusBar from '../../../src/renderer/components/StatusBar';
import { applyAgentCheckoutTransition } from '../../../src/renderer/lib/agentCheckoutTransition';
import { startTerminalSessionBridge } from '../../../src/renderer/lib/terminalSessionBridge';
import { useCheckoutNoticeStore } from '../../../src/renderer/store/checkoutNoticeStore';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useAgentAttentionStore } from '../../../src/renderer/store/agentAttentionStore';
import { EMPTY_ATTENTION } from '../../_helpers/attentionSnapshots';

const WS = 'ws-1';
const MAIN_ID = mainCheckoutContextId(WS);
const MAIN: CheckoutContext = { id: MAIN_ID, workspaceId: WS, environmentId: 'local', path: '/projects/app', kind: 'main' };
const TREE: CheckoutContext = { id: `${WS}::ckt-1`, workspaceId: WS, environmentId: 'local', path: '/projects/app-worktrees/feature', kind: 'worktree', branch: 'feature', mainCheckoutPath: '/projects/app' };

function seed(overrides: Parameters<typeof createWorkspaceFixture>[0] = {}) {
  const workspace = createWorkspaceFixture({
    id: WS, name: 'app', workspacePath: MAIN.path, gitIsRepo: true, gitCurrentBranch: 'main', checkoutContexts: [MAIN],
    terminals: [createTerminalFixture({ id: 'old', workspaceId: WS, checkoutContextId: MAIN_ID, harnessId: 'claude', displayName: 'Odessa', workingDir: MAIN.path })],
    panes: [{ id: 'pane-a', terminalId: 'old' }],
    activeTerminalId: 'old',
    ...overrides,
  });
  useWorkspaceStore.setState({ workspaces: [workspace], activeWorkspaceId: WS, activeWorkspaceLifecycle: 'active' });
  return workspace;
}
const workspace = () => useWorkspaceStore.getState().workspaces[0];
const replaced = (id: string, previous: string, contextId: string, workingDir: string): AgentCheckoutTransitionEvent => ({
  kind: 'terminal-replaced', workspaceId: WS, previousTerminalId: previous,
  terminal: { id, pid: 77, workingDir, checkoutContextId: contextId, environmentId: 'local', harnessId: 'claude', attentionEnabled: true },
});

let killTerminal: ReturnType<typeof vi.fn>;
beforeEach(() => {
  killTerminal = vi.fn().mockResolvedValue({ success: true });
  installElectronApiMock({ killTerminal });
  markTerminalDisposed.mockClear();
  useAgentAttentionStore.setState(EMPTY_ATTENTION);
  useCheckoutNoticeStore.setState({ notice: null });
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, activeWorkspaceLifecycle: null });
});

describe('replaceTerminal', () => {
  it('swaps the terminal inside its pane: same pane, same position, same name', () => {
    seed({ terminals: [
      createTerminalFixture({ id: 'first', workspaceId: WS, checkoutContextId: MAIN_ID, displayName: 'Odessa' }),
      createTerminalFixture({ id: 'second', workspaceId: WS, checkoutContextId: MAIN_ID, displayName: 'Lazarus' }),
    ], panes: [{ id: 'pane-a', terminalId: 'first' }, { id: 'pane-b', terminalId: 'second' }], activeTerminalId: 'first' });
    const before = workspace();

    const ok = useWorkspaceStore.getState().replaceTerminal(WS, 'first', createTerminalFixture({ id: 'new', pid: 5, workspaceId: WS, checkoutContextId: TREE.id, workingDir: TREE.path }));

    expect(ok).toBe(true);
    const after = workspace();
    expect(after.terminals.map((terminal) => terminal.id)).toEqual(['new', 'second']); // order kept
    expect(after.terminals[0]).toMatchObject({ displayName: 'Odessa', checkoutContextId: TREE.id, workingDir: TREE.path, pid: 5 });
    expect(after.panes.map((pane) => pane.id)).toEqual(['pane-a', 'pane-b']); // panes are not recreated
    expect(after.panes.map((pane) => pane.terminalId)).toEqual(['new', 'second']);
    expect(after.activeTerminalId).toBe('new');
    expect(after.layoutRoot).toBe(before.layoutRoot); // the layout tree references pane ids, which did not change
    expect(useWorkspaceStore.getState().activeTerminalId).toBe('new'); // the mirrored active-workspace fields follow
    expect(useWorkspaceStore.getState().terminals.map((terminal) => terminal.id)).toEqual(['new', 'second']);
  });

  it('keeps another terminal active when it was not the replaced one', () => {
    seed({ terminals: [
      createTerminalFixture({ id: 'first', workspaceId: WS }), createTerminalFixture({ id: 'second', workspaceId: WS }),
    ], panes: [{ id: 'pane-a', terminalId: 'first' }, { id: 'pane-b', terminalId: 'second' }], activeTerminalId: 'second' });
    useWorkspaceStore.getState().replaceTerminal(WS, 'first', createTerminalFixture({ id: 'new', workspaceId: WS }));
    expect(workspace().activeTerminalId).toBe('second');
  });

  it('binds a terminal that names no checkout to the workspace\'s main checkout', () => {
    seed();
    useWorkspaceStore.getState().replaceTerminal(WS, 'old', createTerminalFixture({ id: 'new', workspaceId: WS }));
    expect(workspace().terminals[0].checkoutContextId).toBe(MAIN_ID);
  });

  it.each([
    ['an unknown workspace', () => useWorkspaceStore.getState().replaceTerminal('nope', 'old', createTerminalFixture({ id: 'new' }))],
    ['an unknown previous terminal', () => useWorkspaceStore.getState().replaceTerminal(WS, 'missing', createTerminalFixture({ id: 'new' }))],
    ['a replacement that claims another workspace', () => useWorkspaceStore.getState().replaceTerminal(WS, 'old', createTerminalFixture({ id: 'new', workspaceId: 'other' }))],
    ['a replacement id that is already a terminal here', () => useWorkspaceStore.getState().replaceTerminal(WS, 'old', createTerminalFixture({ id: 'second', workspaceId: WS }))],
  ])('changes nothing for %s', (_label, attempt) => {
    seed({ terminals: [
      createTerminalFixture({ id: 'old', workspaceId: WS, checkoutContextId: MAIN_ID }), createTerminalFixture({ id: 'second', workspaceId: WS }),
    ], panes: [{ id: 'pane-a', terminalId: 'old' }, { id: 'pane-b', terminalId: 'second' }] });
    const before = workspace();
    expect(attempt()).toBe(false);
    expect(workspace()).toBe(before);
  });

  it('refuses when the previous terminal has no pane', () => {
    seed({ panes: [] });
    expect(useWorkspaceStore.getState().replaceTerminal(WS, 'old', createTerminalFixture({ id: 'new', workspaceId: WS }))).toBe(false);
  });

  it('leaves other workspaces untouched', () => {
    const other = createWorkspaceFixture({ id: 'ws-2', terminals: [createTerminalFixture({ id: 'old' })], panes: [{ id: 'p', terminalId: 'old' }] });
    seed();
    useWorkspaceStore.setState((state) => ({ workspaces: [...state.workspaces, other] }));
    useWorkspaceStore.getState().replaceTerminal(WS, 'old', createTerminalFixture({ id: 'new', workspaceId: WS }));
    expect(useWorkspaceStore.getState().workspaces[1]).toBe(other);
  });
});

describe('applyAgentCheckoutTransition', () => {
  it('checkout-attached records the context main registered, idempotently', () => {
    seed();
    applyAgentCheckoutTransition({ kind: 'checkout-attached', workspaceId: WS, checkoutContext: TREE });
    applyAgentCheckoutTransition({ kind: 'checkout-attached', workspaceId: WS, checkoutContext: TREE });
    expect(workspace().checkoutContexts).toEqual([MAIN, TREE]);
  });

  it('checkout-attached refuses a context another workspace owns', () => {
    seed();
    applyAgentCheckoutTransition({ kind: 'checkout-attached', workspaceId: WS, checkoutContext: { ...TREE, workspaceId: 'other' } });
    expect(workspace().checkoutContexts).toEqual([MAIN]);
  });

  it('terminal-replaced hands the pane to the replacement and disposes the old terminal\'s xterm first', () => {
    seed();
    applyAgentCheckoutTransition({ kind: 'checkout-attached', workspaceId: WS, checkoutContext: TREE });
    applyAgentCheckoutTransition(replaced('new', 'old', TREE.id, TREE.path));

    expect(markTerminalDisposed).toHaveBeenCalledWith('old');
    expect(workspace().terminals).toEqual([expect.objectContaining({ id: 'new', checkoutContextId: TREE.id, workingDir: TREE.path, harnessId: 'claude', attentionEnabled: true, displayName: 'Odessa' })]);
    expect(workspace().panes).toEqual([{ id: 'pane-a', terminalId: 'new' }]);
    expect(killTerminal).not.toHaveBeenCalled();
  });

  it('closes a replacement whose pane is already gone, so no process runs untracked', () => {
    seed({ terminals: [], panes: [], activeTerminalId: null });
    applyAgentCheckoutTransition(replaced('new', 'old', TREE.id, TREE.path));
    expect(markTerminalDisposed).not.toHaveBeenCalled();
    expect(killTerminal).toHaveBeenCalledWith('new');
    expect(workspace().terminals).toEqual([]);
  });

  it('checkout-released drops the context', () => {
    seed({ checkoutContexts: [MAIN, TREE] });
    applyAgentCheckoutTransition({ kind: 'checkout-released', workspaceId: WS, checkoutContextId: TREE.id });
    expect(workspace().checkoutContexts).toEqual([MAIN]);
  });

  it('notice reaches the notice store', () => {
    applyAgentCheckoutTransition({ kind: 'notice', workspaceId: WS, tone: 'warning', message: 'kept the branch' });
    expect(useCheckoutNoticeStore.getState().notice).toMatchObject({ workspaceId: WS, tone: 'warning', message: 'kept the branch' });
  });
});

describe('the session bridge subscribes to transitions', () => {
  it('applies each event main sends, and unsubscribes on dispose', () => {
    let listener: ((event: AgentCheckoutTransitionEvent) => void) | undefined;
    const dispose = vi.fn();
    installElectronApiMock({ onAgentCheckoutTransition: vi.fn((callback: (event: AgentCheckoutTransitionEvent) => void) => { listener = callback; return dispose; }) });
    seed();
    const stop = startTerminalSessionBridge();

    listener!({ kind: 'checkout-attached', workspaceId: WS, checkoutContext: TREE });
    listener!(replaced('new', 'old', TREE.id, TREE.path));
    expect(workspace().checkoutContexts).toContainEqual(TREE);
    expect(workspace().terminals[0]).toMatchObject({ id: 'new', checkoutContextId: TREE.id });

    stop();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('the exit of the replaced terminal that follows is harmless: its pane already belongs to the replacement', () => {
    let exit: ((event: { id: string; exitCode: number }) => void) | undefined;
    let transition: ((event: AgentCheckoutTransitionEvent) => void) | undefined;
    installElectronApiMock({
      onTerminalExit: vi.fn((callback: (event: { id: string; exitCode: number }) => void) => { exit = callback; return () => undefined; }),
      onAgentCheckoutTransition: vi.fn((callback: (event: AgentCheckoutTransitionEvent) => void) => { transition = callback; return () => undefined; }),
    });
    seed();
    startTerminalSessionBridge();
    transition!(replaced('new', 'old', TREE.id, TREE.path));
    exit!({ id: 'old', exitCode: 129 });
    expect(workspace().terminals.map((terminal) => terminal.id)).toEqual(['new']);
    expect(workspace().panes).toEqual([{ id: 'pane-a', terminalId: 'new' }]);
  });
});

describe('the status bar follows the terminal\'s real checkout (the smoke-test split-brain, as regression)', () => {
  const branchLabel = () => document.querySelector('.status-branch')?.textContent ?? null;
  const branchTitle = () => document.querySelector('.status-branch')?.getAttribute('title') ?? '';

  it('main -> isolated worktree -> main, with the label, tooltip and path always agreeing with the active terminal', () => {
    seed();
    render(<StatusBar />);
    expect(branchLabel()).toBe('main');

    act(() => {
      applyAgentCheckoutTransition({ kind: 'checkout-attached', workspaceId: WS, checkoutContext: TREE });
      applyAgentCheckoutTransition(replaced('wt-terminal', 'old', TREE.id, TREE.path));
    });
    expect(branchLabel()).toBe('feature');
    expect(branchTitle()).toContain(TREE.path);
    expect(branchTitle()).not.toMatch(/removed/);

    act(() => {
      applyAgentCheckoutTransition(replaced('main-terminal', 'wt-terminal', MAIN_ID, MAIN.path));
      applyAgentCheckoutTransition({ kind: 'checkout-released', workspaceId: WS, checkoutContextId: TREE.id });
    });
    expect(branchLabel()).toBe('main');
    expect(branchTitle()).toBe('main');
    expect(workspace().checkoutContexts).toEqual([MAIN]);
  });

  it('never shows a removed worktree after completion', () => {
    seed({ checkoutContexts: [MAIN, { ...TREE, missing: true }], terminals: [
      createTerminalFixture({ id: 'old', workspaceId: WS, checkoutContextId: TREE.id, displayName: 'Odessa' }),
    ] });
    render(<StatusBar />);
    expect(branchLabel()).toContain('removed'); // the pre-fix state: bound to a removed checkout
    act(() => {
      applyAgentCheckoutTransition(replaced('new', 'old', MAIN_ID, MAIN.path));
      applyAgentCheckoutTransition({ kind: 'checkout-released', workspaceId: WS, checkoutContextId: TREE.id });
    });
    expect(branchLabel()).toBe('main');
    expect(document.body.textContent).not.toContain('removed');
  });
});

describe('the transition notice', () => {
  it('shows the outcome for the focused workspace, with its tone, and is dismissible', () => {
    seed();
    render(<StatusBar />);
    expect(document.querySelector('.status-notice')).toBeNull();
    act(() => applyAgentCheckoutTransition({ kind: 'notice', workspaceId: WS, tone: 'warning', message: 'Branch "x" was kept.' }));
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('Branch "x" was kept.');
    expect(notice.className).toContain('status-notice-warning');
    fireEvent.click(notice);
    expect(document.querySelector('.status-notice')).toBeNull();
  });

  it('is not shown for another workspace', () => {
    seed();
    render(<StatusBar />);
    act(() => applyAgentCheckoutTransition({ kind: 'notice', workspaceId: 'someone-else', tone: 'info', message: 'elsewhere' }));
    expect(document.querySelector('.status-notice')).toBeNull();
  });

  it('a newer notice replaces the older one', () => {
    seed();
    render(<StatusBar />);
    act(() => {
      applyAgentCheckoutTransition({ kind: 'notice', workspaceId: WS, tone: 'info', message: 'first' });
      applyAgentCheckoutTransition({ kind: 'notice', workspaceId: WS, tone: 'info', message: 'second' });
    });
    expect(screen.getByRole('status')).toHaveTextContent('second');
  });

  it('a routine (info) notice fades after a few seconds', () => {
    vi.useFakeTimers();
    try {
      seed();
      render(<StatusBar />);
      act(() => applyAgentCheckoutTransition({ kind: 'notice', workspaceId: WS, tone: 'info', message: 'temporary' }));
      expect(screen.getByRole('status')).toBeTruthy();
      act(() => { vi.advanceTimersByTime(5_900); });
      expect(document.querySelector('.status-notice')).not.toBeNull();
      act(() => { vi.advanceTimersByTime(200); });
      expect(document.querySelector('.status-notice')).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('a warning stays longer, because something was left in place or restored', () => {
    vi.useFakeTimers();
    try {
      seed();
      render(<StatusBar />);
      act(() => applyAgentCheckoutTransition({ kind: 'notice', workspaceId: WS, tone: 'warning', message: 'left on disk' }));
      act(() => { vi.advanceTimersByTime(19_900); });
      expect(document.querySelector('.status-notice')).not.toBeNull();
      act(() => { vi.advanceTimersByTime(200); });
      expect(document.querySelector('.status-notice')).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});
