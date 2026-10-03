import { clankerUi18, clankerUi36 } from '../lib/branding';
import WindowControls from './WindowControls';
import WorkspaceTabs from './WorkspaceTabs';
import { useWorkspaceNavigationStore } from '../store/workspaceNavigationStore';
import './TitleBar.css';

interface TitleBarProps {
  onOpenWorkspace?: () => void;
}

export default function TitleBar({ onOpenWorkspace }: TitleBarProps) {
  const sidebarMode = useWorkspaceNavigationStore((state) => state.mode === 'sidebar');
  return (
    <div className="titlebar">
      <div className="titlebar-left">
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
        {!sidebarMode && <WorkspaceTabs onOpenWorkspace={onOpenWorkspace} />}
      </div>

      <WindowControls className="titlebar-controls" buttonClassName="titlebar-control" closeClassName="close" />
    </div>
  );
}
