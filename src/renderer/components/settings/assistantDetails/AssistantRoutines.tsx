import { useEffect, useState } from 'react';
import type { AssistantDetails, AssistantRead, AssistantRoutine, AssistantRun } from '../../../../shared/types/assistantDetails';
import { Button } from '../../ui/Button';
import { DataList, DetailCard, DetailSection, StatusLabel } from '../../ui/DetailPresentation';
import { AssistantReadList, AssistantTimestamp } from './AssistantReadState';
import { AssistantRuns } from './AssistantRuns';
function RoutineCard({ assistantId, job }: { assistantId: string; job: AssistantRoutine }) {
  const [expanded, setExpanded] = useState(false);
  const [runs, setRuns] = useState<AssistantRead<AssistantRun[]>>();
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    void window.electronAPI.getAssistantRoutineRuns(assistantId, job.id).then((value) => { if (!cancelled) setRuns(value); }, () => { if (!cancelled) setRuns({ state: 'error' }); });
    return () => { cancelled = true; };
  }, [expanded, assistantId, job.id]);
  return <DetailCard title={job.name} status={<StatusLabel tone={job.enabled === false ? 'muted' : 'neutral'}>{job.enabled === true ? 'Enabled' : job.enabled === false ? 'Disabled / paused' : 'Enabled state not reported'}</StatusLabel>}>
    <DataList items={[
      { label: 'Hermes state', value: job.state }, { label: 'Schedule', value: job.schedule }, { label: 'Timezone', value: job.timezone },
      { label: 'Next run', value: <AssistantTimestamp value={job.nextRun} /> }, { label: 'Last run', value: <AssistantTimestamp value={job.lastRun} /> }, { label: 'Last result', value: job.lastResult },
    ]} /><Button variant="ghost" size="sm" aria-expanded={expanded} onClick={() => { setRuns(undefined); setExpanded(!expanded); }}>{expanded ? 'Hide recent runs' : 'Inspect recent runs'}</Button>
    {expanded && <AssistantRuns runs={runs} />}
  </DetailCard>;
}
export function AssistantRoutines({ assistantId, displayName, routines }: { assistantId: string; displayName: string; routines?: AssistantDetails['routines'] }) {
  return <DetailSection title="Routines / Scheduled tasks" description={`Owned and executed by Hermes for ${displayName}. Read-only; Clanker never starts or schedules a job.`}>
    <AssistantReadList value={routines} empty="No scheduled tasks reported for this profile.">{(jobs) => <ul className="assistant-detail-cards">{jobs.map((job) => <li key={job.id}><RoutineCard assistantId={assistantId} job={job} /></li>)}</ul>}</AssistantReadList>
  </DetailSection>;
}
