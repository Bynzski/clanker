import { isWorkspacePageCommand, type KeybindingCommandId } from '../../shared/keybindings';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useKeybindingStore } from '../store/keybindingStore';
import { useAssistantNavStore } from '../store/assistantNavStore';
import { workspaceBrowserPresented } from '../store/workspacePages';

/** Shared execution for registry-matched app, xterm, and native Browser keystrokes. */
export function executeWorkspacePageCommand(command: KeybindingCommandId, browserOwnerId?: string): boolean {
  if (!isWorkspacePageCommand(command)) return false;
  if (useKeybindingStore.getState().capturing) return true;
  const state = useWorkspaceStore.getState();
  const workspace = state.workspaces.find((entry) => entry.id === state.activeWorkspaceId);
  if (useAssistantNavStore.getState().activeAssistantId || !workspace?.pages?.length) return true;
  if (browserOwnerId && (workspace.id !== browserOwnerId || !workspaceBrowserPresented(workspace) || workspace.browserOverlayCount)) return true;
  const index = workspace.pages.findIndex((page) => page.id === workspace.activePageId);
  const count = workspace.pages.length;
  const target = command === 'workspace.pageNext' ? (index + 1) % count
    : command === 'workspace.pagePrevious' ? (index - 1 + count) % count : Number(command.slice('workspace.page'.length)) - 1;
  const page = workspace.pages[target];
  if (page) state.selectWorkspacePage(workspace.id, page.id);
  return true;
}
