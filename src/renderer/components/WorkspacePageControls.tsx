import { useState } from 'react';
import { useDndContext, useDroppable } from '@dnd-kit/core';
import { useSharedPaneDrag } from './WorkspacePaneDragProvider';
import { currentPaneDrag } from '../lib/workspacePaneDrag';
import { useBrowserOverlaySuppression } from '../lib/useBrowserOverlaySuppression';
import { Maximize2, Minimize2, Minus, Plus, X } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { WorkspaceTab } from '../store/workspaceTypes';
import { activePage, MAX_WORKSPACE_PAGES } from '../store/workspacePages';
import { closeWorkspaceTerminal } from '../lib/workspaceTerminalClose';
import { useTerminalAttention } from '../lib/useTerminalAttention';
import { AgentAttentionState } from './AgentAttentionIndicators';
import type { MinimizedPane } from '../store/workspaceTypes';
import './WorkspacePageControls.css';

export function PanePresentationControls({ workspace, paneId }: { workspace: WorkspaceTab; paneId: string }) {
  const minimize = useWorkspaceStore((state) => state.minimizeWorkspacePane);
  const maximize = useWorkspaceStore((state) => state.toggleMaximizedPane);
  const maximized = activePage(workspace)?.maximizedPaneId === paneId;
  return <>
    <button type="button" className="pane-presentation-button" aria-label="Minimize pane" title="Minimize pane" onClick={() => minimize(workspace.id, paneId)}><Minus size={14} /></button>
    <button type="button" className="pane-presentation-button" aria-label={maximized ? 'Restore pane size' : 'Maximize pane'} title={maximized ? 'Restore pane size' : 'Maximize pane'} onClick={() => maximize(workspace.id, paneId)}>{maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
  </>;
}

function MinimizedPaneEntry({ workspace, entry }: { workspace: WorkspaceTab; entry: MinimizedPane }) {
  const restore = useWorkspaceStore((state) => state.restoreWorkspacePane);
  const pane = workspace.panes.find((item) => item.id === entry.paneId);
  const terminal = workspace.terminals.find((item) => item.id === pane?.terminalId);
  const attention = useTerminalAttention(terminal?.id ?? null);
  const name = terminal?.displayName ?? (entry.paneId === workspace.browserPane?.id ? 'Browser' : entry.paneId === workspace.editorPane?.id ? 'Editor' : entry.paneId === workspace.notesPane?.id ? 'Notes' : 'Terminal');
  return <li><button type="button" onClick={(event) => { const menu = event.currentTarget.closest('details'); if (menu) menu.open = false; restore(workspace.id, entry.paneId); }} title="Restore pane">
    {name}{terminal?.attentionEnabled && <AgentAttentionState attention={attention} name={name} />}
  </button>{terminal && <button type="button" aria-label={`Close ${name}`} onClick={() => void closeWorkspaceTerminal(workspace.id, terminal.id)}><X size={12} /></button>}</li>;
}

function PageDropButton({ workspace, pageId, index }: { workspace: WorkspaceTab; pageId?: string; index?: number }) {
  const select = useWorkspaceStore((state) => state.selectWorkspacePage);
  const add = useWorkspaceStore((state) => state.addWorkspacePage);
  const { active } = useDndContext();
  const shared = useSharedPaneDrag();
  const capped = pageId === undefined && (workspace.pages?.length ?? 0) >= MAX_WORKSPACE_PAGES;
  const available = shared && !capped && Boolean(currentPaneDrag(active?.data.current, workspace));
  const { setNodeRef, isOver } = useDroppable({ id: `workspace-page-drop-${workspace.id}-${pageId ?? 'new'}`,
    data: { intent: { kind: 'workspace-page', workspaceId: workspace.id, pageId } }, disabled: !available });
  return <button ref={setNodeRef} type="button" className={`${available ? 'page-drop-valid' : ''}${available && isOver ? ' page-drop-over' : ''}`}
    aria-label={pageId ? `Page ${index! + 1}` : 'Add page'} title={pageId ? undefined : 'Add page'}
    aria-current={pageId && pageId === workspace.activePageId ? 'page' : undefined} disabled={capped}
    onClick={() => pageId ? select(workspace.id, pageId) : add(workspace.id)}>
    {pageId ? index! + 1 : <Plus size={12} />}
  </button>;
}

export function WorkspacePageSwitcher({ workspace }: { workspace: WorkspaceTab }) {
  const remove = useWorkspaceStore((state) => state.removeWorkspacePage);
  const pages = workspace.pages ?? [];
  const minimized = workspace.minimizedPanes ?? [];
  const [menuOpen, setMenuOpen] = useState(false);
  useBrowserOverlaySuppression(menuOpen && minimized.length > 0, workspace.id);
  const selected = activePage(workspace);
  const removable = pages.length > 1 && !selected?.layoutRoot && !minimized.some((entry) => entry.pageId === selected?.id);
  return <nav className="workspace-page-switcher" aria-label="Workspace pages">
    {pages.map((page, index) => <PageDropButton key={page.id} workspace={workspace} pageId={page.id} index={index} />)}
    <PageDropButton workspace={workspace} />
    {pages.length > 1 && <button type="button" aria-label="Remove empty page" title={removable ? 'Remove empty page' : 'Only empty pages can be removed'} disabled={!removable} onClick={() => selected && remove(workspace.id, selected.id)}><X size={12} /></button>}
    {minimized.length > 0 && <details className="minimized-pane-menu" onToggle={(event) => setMenuOpen(event.currentTarget.open)}><summary title="Minimized panes">Minimized · {minimized.length}</summary><ul aria-label="Minimized panes">{minimized.map((entry) => <MinimizedPaneEntry key={entry.paneId} workspace={workspace} entry={entry} />)}</ul></details>}
  </nav>;
}
