import { useCallback, useState } from 'react';
import { Group, Panel, Separator, type Layout } from 'react-resizable-panels';
import AssistantTerminal from './AssistantTerminal';
import AssistantBrowserPanel from './AssistantBrowserPanel';
import { DEFAULT_SIDECAR_PRIMARY_RATIO, useAssistantSurfaceStore } from '../../store/assistantSurfaceStore';
import './AssistantsRoster.css';

/**
 * The Assistant's surface shell: a primary slot plus an optional sidecar. The primary (today the Hermes
 * terminal) always exists and is never remounted when the sidecar opens or closes; Browser is the only
 * sidecar for now. The shell owns active/parked state and the split, and knows nothing about xterm or
 * Hermes. It stays mounted while parked so an in-flight turn is never ended by navigation.
 */
export default function AssistantSurface({ assistantId, displayName, isActive }: { assistantId: string; displayName: string; isActive: boolean }) {
  const ui = useAssistantSurfaceStore((state) => state.byId[assistantId]);
  const setRatio = useAssistantSurfaceStore((state) => state.setRatio);
  const sidecarVisible = ui?.browserVisible ?? false;
  const primaryRatio = ui?.sidecarRatio ?? DEFAULT_SIDECAR_PRIMARY_RATIO;
  // Bumped on every layout change so the sidecar recomputes its native view bounds.
  const [layoutVersion, setLayoutVersion] = useState(0);
  const handleLayoutChanged = useCallback((layout: Layout) => {
    const primary = layout['assistant-primary'];
    if (typeof primary === 'number' && layout['assistant-sidecar'] !== undefined) setRatio(assistantId, primary);
    setLayoutVersion((version) => version + 1);
  }, [assistantId, setRatio]);

  return (
    <section className={`assistant-surface ${isActive ? 'active' : 'parked'}`} data-assistant-id={assistantId} aria-hidden={!isActive} aria-label={`${displayName} Bot Chat`}>
      <div className="assistant-surface-header">{displayName} · Hermes Bot Chat</div>
      <Group
        id={`assistant-${assistantId}`}
        className="split-group split-horizontal assistant-surface-body"
        orientation="horizontal"
        resizeTargetMinimumSize={{ coarse: 28, fine: 20 }}
        onLayoutChanged={handleLayoutChanged}
      >
        <Panel id="assistant-primary" defaultSize={sidecarVisible ? primaryRatio : 100} minSize={20}>
          <AssistantTerminal assistantId={assistantId} isActive={isActive} />
        </Panel>
        {sidecarVisible && <Separator className="split-separator" />}
        {sidecarVisible && (
          <Panel id="assistant-sidecar" defaultSize={100 - primaryRatio} minSize={15}>
            <AssistantBrowserPanel assistantId={assistantId} isActive={isActive} layoutVersion={layoutVersion} />
          </Panel>
        )}
      </Group>
    </section>
  );
}
