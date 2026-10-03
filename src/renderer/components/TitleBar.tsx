import type { ReactNode } from 'react';
import { clankerUi18, clankerUi36 } from '../lib/branding';
import WindowControls from './WindowControls';
import WorkspaceTabs from './WorkspaceTabs';
import { useWorkspaceNavigationStore } from '../store/workspaceNavigationStore';
import { isWorkspaceSidebarCollapsed } from '../../shared/types/workspaceNavigation';

/** `.main-content` inset (var(--space-sm)) before the sidebar's left edge. */
const SIDEBAR_INSET = 8;
import './TitleBar.css';

interface TitleBarProps {
  onOpenWorkspace?: () => void;
  /** Sidebar mode has no tab strip, so the workspace toolbar docks here instead of taking its own row. */
  toolbar?: ReactNode;
}

export default function TitleBar({ onOpenWorkspace, toolbar }: TitleBarProps) {
  const sidebarMode = useWorkspaceNavigationStore((state) => state.mode === 'sidebar');
  const sidebarWidth = useWorkspaceNavigationStore((state) => state.sidebarWidth);
  const docked = sidebarMode && Boolean(toolbar);
  const railCollapsed = docked && isWorkspaceSidebarCollapsed(sidebarWidth);
  return (
    <div className={`titlebar${sidebarMode && toolbar ? ' titlebar-with-toolbar' : ''}`}>
      {/* With the toolbar docked, the brand spans the sidebar column so the toolbar starts over the panes. */}
      <div
        className={`titlebar-left${railCollapsed ? ' rail' : ''}`}
        style={docked ? { width: sidebarWidth + SIDEBAR_INSET } : undefined}
      >
        <div className="titlebar-brand">
          <img
            src={clankerUi18}
            srcSet={`${clankerUi18} 1x, ${clankerUi36} 2x`}
            alt=""
            width={18}
            height={18}
          />
          <span className="titlebar-title">Clanker Grid</span>
        </div>
      </div>

      <div className="titlebar-center" data-navigation-mode={sidebarMode ? 'sidebar' : 'tabs'}>
        {sidebarMode ? toolbar : <WorkspaceTabs onOpenWorkspace={onOpenWorkspace} />}
      </div>

      <WindowControls className="titlebar-controls" buttonClassName="titlebar-control" closeClassName="close" />
    </div>
  );
}
