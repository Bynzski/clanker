import { useEffect, useState } from 'react';
import type { AssistantDetails, AssistantRead, AssistantRoutine, AssistantRun } from '../../../../shared/types/assistantDetails';
import { Button } from '../../ui/Button';
import { DataList, DetailCard, DetailSection, StatusLabel } from '../../ui/DetailPresentation';
import { FormMessage } from '../../ui/Field';
import { AssistantReadList, AssistantTimestamp } from './AssistantReadState';
import { AssistantRuns } from './AssistantRuns';
export type RoutineRunReader = (jobId: string) => Promise<AssistantRead<AssistantRun[]>>;
const ATTEMPT = { completed: 'Completed', failed: 'Failed', unknown: 'Unknown result', claimed: 'Claimed (liveness unverified)', running: 'In-progress record (liveness unverified)' };
function RoutineCard({ loadRuns, job }: { loadRuns: RoutineRunReader; job: AssistantRoutine }) {
  const [expanded, setExpanded] = useState(false);
  const [runs, setRuns] = useState<AssistantRead<AssistantRun[]>>();
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    void loadRuns(job.id).then((value) => { if (!cancelled) setRuns(value); }, () => { if (!cancelled) setRuns({ state: 'error' }); });
    return () => { cancelled = true; };
  }, [expanded, loadRuns, job.id]);
  return <DetailCard title={job.name} status={<StatusLabel tone={job.enabled === false ? 'muted' : 'neutral'}>{job.enabled === true ? 'Enabled' : job.enabled === false ? 'Disabled / paused' : 'Enabled state not reported'}</StatusLabel>}>
    <DataList items={[
      { label: 'Hermes configuration state', value: job.state },
      { label: 'Schedule type', value: job.scheduleKind === 'once' ? 'One-shot' : job.scheduleKind ? 'Recurring' : undefined },
      { label: 'Schedule', value: job.schedule }, { label: 'Timezone', value: job.timezone },
      { label: 'Configured next run', value: job.nextRunAbsent ? 'No next run recorded' : <AssistantTimestamp value={job.nextRun} /> },
      { label: 'Last recorded run', value: job.lastRunAbsent ? 'No run recorded' : <AssistantTimestamp value={job.lastRun} /> },
      { label: 'Recorded run count', value: job.recordedRuns }, { label: 'Last reported result', value: job.lastResult ?? 'Unknown' },
      ...(job.latestAttempt ? [
        { label: 'Latest attempt record', value: ATTEMPT[job.latestAttempt.status] },
        { label: 'Attempt claimed', value: <AssistantTimestamp value={job.latestAttempt.claimedAt} /> },
        { label: 'Attempt finished', value: <AssistantTimestamp value={job.latestAttempt.finishedAt} /> },
      ] : []),
    ]} /><Button variant="ghost" size="sm" aria-expanded={expanded} onClick={() => { setRuns(undefined); setExpanded(!expanded); }}>{expanded ? 'Hide recent runs' : 'Inspect recent runs'}</Button>
    {expanded && <AssistantRuns runs={runs} />}
  </DetailCard>;
}
export function AssistantRoutines({ loadRuns, displayName, routines }: { loadRuns: RoutineRunReader; displayName: string; routines?: AssistantDetails['routines'] }) {
  return <DetailSection title="Routines / Scheduled tasks" description={`Owned and executed by Hermes for ${displayName}. Read-only; Clanker never starts or schedules a job.`}>
    <FormMessage>Scheduler runtime health: Unknown. Enabled and next-run values are configuration, not proof of an active scheduler or a guarantee of execution.</FormMessage>
    <FormMessage>Up to 128 jobs and 20 recent records per job; refresh is on demand. Missing history does not prove a task never ran.</FormMessage>
    <AssistantReadList value={routines} empty="No scheduled tasks reported for this profile.">{(jobs) => <ul className="assistant-detail-cards">{jobs.map((job) => <li key={job.id}><RoutineCard loadRuns={loadRuns} job={job} /></li>)}</ul>}</AssistantReadList>
  </DetailSection>;
}
