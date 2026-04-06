import { Group, Panel, Separator } from 'react-resizable-panels';
import type {
  LayoutNode,
  LayoutLeaf,
  LayoutSplit,
} from '../store/workspaceStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import TerminalPane from './TerminalPane';
import BrowserPanel from './BrowserPanel';
import './DynamicPaneLayout.css';

function isLeaf(node: LayoutNode): node is LayoutLeaf {
  return node.type === 'leaf';
}

function isSplit(node: LayoutNode): node is LayoutSplit {
  return node.type === 'split';
}

function isLeafLocked(
  paneId: string,
  state: ReturnType<typeof useWorkspaceStore.getState>
) {
  const { panes, browserPane, browserVisible } = state;
  if (browserVisible && browserPane?.id === paneId) {
    return browserPane.locked;
  }
  return panes.find((pane) => pane.id === paneId)?.locked ?? false;
}

function SplitView({ node }: { node: LayoutSplit }) {
  const state = useWorkspaceStore();
  const { setSplitRatio } = state;
  const firstRatio = Math.max(10, Math.min(90, Math.round(node.ratio * 100)));
  const secondRatio = 100 - firstRatio;

  return (
    <Group
      id={node.nodeId}
      className={`split-group split-${node.orientation}`}
      orientation={node.orientation}
      defaultLayout={[firstRatio, secondRatio]}
      resizeTargetMinimumSize={{ coarse: 28, fine: 20 }}
      onLayoutChanged={(layout) => {
        if (!Array.isArray(layout)) {
          return;
        }
        const total = layout.reduce((sum, value) => sum + value, 0);
        if (total <= 0) {
          return;
        }

        setSplitRatio(node.nodeId, layout[0] / total);
      }}
    >
      <Panel
        id={`${node.nodeId}-a`}
        defaultSize={firstRatio}
        minSize={12}
        disabled={isSubtreeLocked(node.first, state)}
      >
        <LayoutNodeView node={node.first} />
      </Panel>
      <Separator className="split-separator" />
      <Panel
        id={`${node.nodeId}-b`}
        defaultSize={secondRatio}
        minSize={12}
        disabled={isSubtreeLocked(node.second, state)}
      >
        <LayoutNodeView node={node.second} />
      </Panel>
    </Group>
  );
}

function isSubtreeLocked(
  node: LayoutNode,
  state: ReturnType<typeof useWorkspaceStore.getState>
): boolean {
  if (isLeaf(node)) {
    return isLeafLocked(node.paneId, state);
  }

  return isSubtreeLocked(node.first, state) && isSubtreeLocked(node.second, state);
}

function LeafView({ node }: { node: LayoutLeaf }) {
  const state = useWorkspaceStore();
  const { browserPane, browserVisible, browserUrl, setBrowserUrl, swapPanes, layoutRevision } = state;
  const paneId = node.paneId;

  if (browserVisible && browserPane?.id === paneId) {
    return (
      <BrowserPanel
        url={browserUrl}
        onUrlChange={setBrowserUrl}
        layoutVersion={layoutRevision}
      />
    );
  }

  return (
    <TerminalPane
      paneId={paneId}
      onSwapPane={swapPanes}
    />
  );
}

function LayoutNodeView({ node }: { node: LayoutNode }) {
  if (isLeaf(node)) {
    return <LeafView node={node} />;
  }

  return <SplitView node={node} />;
}

function renderLayout(root: LayoutNode | null): JSX.Element | null {
  if (root == null) {
    return null;
  }

  return <LayoutNodeView node={root} />;
}

export default function DynamicPaneLayout() {
  const { layoutRoot } = useWorkspaceStore();

  if (layoutRoot == null) {
    return (
      <div className="dynamic-pane-layout empty">
        <div className="empty-state">
          <span>No terminals open</span>
          <span className="hint">Use the + New Terminal button in the header</span>
        </div>
      </div>
    );
  }

  return (
    <div className="dynamic-pane-layout">
      <div className="split-root">
        {renderLayout(layoutRoot)}
      </div>
    </div>
  );
}
