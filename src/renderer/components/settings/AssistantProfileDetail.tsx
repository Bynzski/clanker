import { useEffect, useState } from 'react';
import type { AssistantDetails } from '../../../shared/types/assistantDetails';
import type { HermesAssistant } from '../../../shared/types/assistants';
import { Button } from '../ui/Button';
import { FormMessage } from '../ui/Field';
import { AssistantOverview } from './assistantDetails/AssistantOverview';
import { AssistantCapabilities } from './assistantDetails/AssistantCapabilities';
import { AssistantHistory } from './assistantDetails/AssistantHistory';
import { AssistantRoutines } from './assistantDetails/AssistantRoutines';
import './AssistantProfileDetail.css';

/** Selected-profile request owner only; the presentation sections remain independently replaceable. */
export default function AssistantProfileDetail({ assistant, connected }: { assistant: HermesAssistant; connected: boolean }) {
  const [details, setDetails] = useState<AssistantDetails>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    void window.electronAPI.getAssistantDetails(assistant.id).then((value) => {
      if (!cancelled && value.assistantId === assistant.id) setDetails(value);
    }, () => { if (!cancelled) setDetails({ assistantId: assistant.id, profile: { state: 'error' }, history: { state: 'error' }, routines: { state: 'error' } }); });
    return () => { cancelled = true; };
  }, [assistant.id, connected, revision]);
  return <section className="assistant-profile-detail" aria-label={`${assistant.displayName} profile`}>
    <div className="assistant-profile-heading"><h3>{assistant.displayName}</h3><Button variant="ghost" size="sm" disabled={!connected} onClick={() => { setDetails(undefined); setRevision((value) => value + 1); }}>Refresh details</Button></div>
    {assistant.description && <FormMessage>{assistant.description}</FormMessage>}
    {!connected ? <FormMessage role="status">Offline — profile metadata and scheduled tasks unavailable.</FormMessage> : <>
      <AssistantOverview assistant={assistant} profile={details?.profile} />
      <AssistantCapabilities profile={details?.profile} />
      <AssistantHistory history={details?.history} />
      <AssistantRoutines key={revision} assistantId={assistant.id} displayName={assistant.displayName} routines={details?.routines} />
    </>}
  </section>;
}
