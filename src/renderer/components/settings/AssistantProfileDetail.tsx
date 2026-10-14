import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssistantDetails } from '../../../shared/types/assistantDetails';
import type { HermesAssistant } from '../../../shared/types/assistants';
import { Button } from '../ui/Button';
import { FormMessage } from '../ui/Field';
import { AssistantAppearance } from './assistantDetails/AssistantAppearance';
import { AssistantOverview } from './assistantDetails/AssistantOverview';
import { AssistantCapabilities } from './assistantDetails/AssistantCapabilities';
import { AssistantHistory } from './assistantDetails/AssistantHistory';
import { AssistantRoutines } from './assistantDetails/AssistantRoutines';
import { useAssistantsStore } from '../../store/assistantsStore';
import './AssistantProfileDetail.css';

/** Selected-profile request owner only; the presentation sections remain independently replaceable. */
export default function AssistantProfileDetail({ assistant, connected }: { assistant: HermesAssistant; connected: boolean }) {
  const [details, setDetails] = useState<AssistantDetails>();
  const [revision, setRevision] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const requestEpoch = useRef(0);
  const loadRuns = useCallback((jobId: string) => window.electronAPI.getAssistantRoutineRuns(assistant.id, jobId), [assistant.id]);
  useEffect(() => {
    setRefreshing(false);
    if (!connected) return;
    const epoch = ++requestEpoch.current; let cancelled = false;
    void window.electronAPI.getAssistantDetails(assistant.id).then((value) => {
      if (!cancelled && value.assistantId === assistant.id) setDetails(value);
    }, () => { if (!cancelled) setDetails({ assistantId: assistant.id, profile: { state: 'error' }, history: { state: 'error' }, routines: { state: 'error' } }); });
    return () => { cancelled = true; requestEpoch.current = epoch + 1; };
  }, [assistant.id, connected, revision]);
  const refreshDetails = async () => {
    const epoch = requestEpoch.current; setRefreshing(true);
    try {
      // One owner refreshes the roster first, then reloads both sections; no sibling-effect race.
      await useAssistantsStore.getState().refresh();
      if (requestEpoch.current === epoch) { setDetails(undefined); setRevision((value) => value + 1); }
    } finally { if (requestEpoch.current === epoch) setRefreshing(false); }
  };
  const currentDetails = details?.assistantId === assistant.id ? details : undefined;
  return <section className="assistant-profile-detail" aria-label={`${assistant.displayName} profile`}>
    <div className="assistant-profile-heading"><h3>{assistant.displayName}</h3><Button variant="ghost" size="sm" disabled={!connected || !currentDetails || refreshing} onClick={() => void refreshDetails()}>Refresh details</Button></div>
    {assistant.description && <FormMessage>{assistant.description}</FormMessage>}
    {!connected ? <FormMessage role="status">Offline — profile metadata and scheduled tasks unavailable.</FormMessage> : <>
      <AssistantAppearance assistantId={assistant.id} connected={connected} revision={revision} onRefresh={refreshDetails} />
      <AssistantOverview assistant={assistant} profile={currentDetails?.profile} />
      <AssistantCapabilities profile={currentDetails?.profile} />
      <AssistantHistory history={currentDetails?.history} />
      <AssistantRoutines key={revision} loadRuns={loadRuns} displayName={assistant.displayName} routines={currentDetails?.routines} />
    </>}
  </section>;
}
