import { useEffect, useState } from 'react';
import type { AssistantRead, AssistantRoutine } from '../../../../shared/types/assistantDetails';
import { Button } from '../../ui/Button';
import { Disclosure } from '../../ui/DetailPresentation';
import { FormMessage } from '../../ui/Field';
import { AssistantRoutines } from './AssistantRoutines';
const loadRuns = (id: string) => window.electronAPI.getDefaultHermesRoutineRuns(id);
/** A read-only default namespace, not a roster entry, Assistant ID or Bot Chat destination. */
export function DefaultHermesRoutines({ connected }: { connected: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [revision, setRevision] = useState(0);
  const [routines, setRoutines] = useState<AssistantRead<AssistantRoutine[]>>();
  useEffect(() => {
    if (!expanded || !connected) return;
    let cancelled = false;
    void window.electronAPI.getDefaultHermesRoutines().then((value) => { if (!cancelled) setRoutines(value); }, () => { if (!cancelled) setRoutines({ state: 'error' }); });
    return () => { cancelled = true; };
  }, [expanded, connected, revision]);
  return <Disclosure title="Default Hermes · Scheduled tasks" open={expanded} onToggle={(event) => { const open = event.currentTarget.open; if (open !== expanded) setRoutines(undefined); setExpanded(open); }}>
    <FormMessage>This is the connected service’s default profile namespace, separate from named Assistants. Ordinary Hermes harness usage remains independent. This view creates no Assistant or Bot Chat and never starts a scheduler.</FormMessage>
    {!connected ? <FormMessage role="status">Offline — default-profile tasks require the enabled, connected local Hermes service. The ordinary Hermes CLI can work independently.</FormMessage> : <>
      <Button variant="ghost" size="sm" disabled={!routines} onClick={() => { setRoutines(undefined); setRevision((value) => value + 1); }}>Refresh default tasks</Button>
      {expanded && <AssistantRoutines key={revision} displayName="the default Hermes profile" routines={routines} loadRuns={loadRuns} />}
    </>}
  </Disclosure>;
}
