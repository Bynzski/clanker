import { useWorkspaceStore, autoCalculateLayout } from '../store/workspaceStore';
import TerminalPane from './TerminalPane';
import './DynamicPaneLayout.css';

export default function DynamicPaneLayout() {
  const { panes, terminals } = useWorkspaceStore();

  if (panes.length === 0) {
    return (
      <div className="dynamic-pane-layout empty">
        <div className="empty-state">
          <span>No terminals open</span>
          <span className="hint">Use the + New Terminal button in the header</span>
        </div>
      </div>
    );
  }
  
  const layout = autoCalculateLayout(panes.length);
  
  return (
    <div className="dynamic-pane-layout">
      <div
        id="main-layout"
        className="dynamic-pane-grid"
        style={{
          gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
          gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
        }}
      >
        {panes.map((pane) => {
          const terminal = terminals.find(t => t.id === pane.terminalId);
          return (
            <div className="dynamic-pane-cell" key={pane.id}>
              <TerminalPane terminal={terminal} paneId={pane.id} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
