import WindowControls from './WindowControls';
import WorkspaceTabs from './WorkspaceTabs';
import './TitleBar.css';

interface TitleBarProps {
  onOpenWorkspace?: () => void;
}

export default function TitleBar({ onOpenWorkspace }: TitleBarProps) {
  return (
    <div className="titlebar">
      <div className="titlebar-left">
        <div className="titlebar-brand">
          <img
            src="./titlebar-icon.png"
            alt="Clanker Grid icon"
            width={18}
            height={18}
          />
          <span className="titlebar-title">Clanker Grid</span>
        </div>
      </div>

      <div className="titlebar-center">
        <WorkspaceTabs onOpenWorkspace={onOpenWorkspace} />
      </div>

      <WindowControls className="titlebar-controls" buttonClassName="titlebar-control" closeClassName="close" />
    </div>
  );
}
