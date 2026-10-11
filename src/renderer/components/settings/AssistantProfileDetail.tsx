import { useEffect, useState, type ReactNode } from 'react';
import type { AssistantCapability, AssistantDetails, AssistantRead, AssistantRoutine, AssistantRun } from '../../../shared/types/assistantDetails';
import type { HermesAssistant } from '../../../shared/types/assistants';
import { Button } from '../ui/Button';
import './AssistantProfileDetail.css';

const READ_STATE = { offline: 'Offline — metadata unavailable.', unavailable: 'Profile or data is no longer available.', unsupported: 'Not supported by this Hermes version.', error: 'Could not read from Hermes. Try refreshing.' };
function ReadSection<T>({ value, empty, children }: { value?: AssistantRead<T[]>; empty: string; children: (data: T[]) => ReactNode }) {
  if (!value) return <p role="status">Loading…</p>;
  if (value.state !== 'ready') return <p role={value.state === 'error' ? 'alert' : 'status'}>{READ_STATE[value.state]}</p>;
  return value.data.length ? children(value.data) : <p>{empty}</p>;
}
function time(value?: number): string { return value ? new Date(value * 1000).toLocaleString() : 'Not reported'; }
function CapabilityList({ title, rows }: { title: string; rows?: AssistantCapability[] }) {
  return <div><h4>{title}{rows && ` · ${rows.filter((row) => row.enabled === true).length} enabled / ${rows.length} installed`}</h4>
    {!rows ? <p>Not reported</p> : !rows.length ? <p>None configured</p> : <ul>{rows.map((row, index) => <li key={`${row.name}-${index}`}>{row.name} · {row.enabled === true ? 'Enabled' : row.enabled === false ? 'Disabled' : 'State not reported'}</li>)}</ul>}</div>;
}
function RoutineRuns({ assistantId, job }: { assistantId: string; job: AssistantRoutine }) {
  const [expanded, setExpanded] = useState(false);
  const [runs, setRuns] = useState<AssistantRead<AssistantRun[]>>();
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    void window.electronAPI.getAssistantRoutineRuns(assistantId, job.id).then((value) => { if (!cancelled) setRuns(value); }, () => { if (!cancelled) setRuns({ state: 'error' }); });
    return () => { cancelled = true; };
  }, [expanded, assistantId, job.id]);
  return <li className="assistant-routine"><strong>{job.name}</strong>
    <p>{job.enabled === true ? 'Enabled' : job.enabled === false ? 'Disabled / paused' : 'Enabled state not reported'}{job.state && ` · Hermes state: ${job.state}`}</p>
    <p>Schedule: {job.schedule ?? 'Not reported'} · Timezone: {job.timezone ?? 'Not reported'}</p>
    <p>Next run: {job.nextRun ?? 'Not reported'}</p><p>Last run: {job.lastRun ?? 'Not reported'} · Result: {job.lastResult ?? 'Not reported'}</p>
    <Button variant="ghost" size="sm" aria-expanded={expanded} onClick={() => { setRuns(undefined); setExpanded(!expanded); }}>{expanded ? 'Hide recent runs' : 'Inspect recent runs'}</Button>
    {expanded && <ReadSection value={runs} empty="No recent runs reported.">{(rows) => <ul>{rows.map((run, index) => <li key={index}>
      <strong>{run.title ?? 'Untitled run'}</strong><p>{run.source === 'cron_output' ? 'Script / output record' : 'Agent session'} · Started: {time(run.startedAt)} · Ended: {time(run.endedAt)}</p>
      <p>Run result is not independently reported; an ended session does not prove success.</p>
      {run.preview && <pre aria-label="Hermes output preview">{run.preview}</pre>}
    </li>)}</ul>}</ReadSection>}
  </li>;
}
/** Mounted only for the selected live profile. No cache or polling; old requests cannot populate another profile. */
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
  const activity = assistant.activity;
  const profile = details?.profile;
  return <section className="assistant-profile-detail" aria-label={`${assistant.displayName} profile`}>
    <div className="assistant-profile-heading"><h3>{assistant.displayName}</h3><Button variant="ghost" size="sm" disabled={!connected} onClick={() => { setDetails(undefined); setRevision((value) => value + 1); }}>Refresh details</Button></div>
    {assistant.description && <p>{assistant.description}</p>}
    {!connected ? <p role="status">Offline — profile metadata and scheduled tasks unavailable.</p> : <>
      <h4>Overview · Hermes-reported</h4>
      <p>Model: {profile?.state === 'ready' ? profile.data.model ?? activity?.model ?? 'Not reported' : activity?.model ?? 'Not reported'} · Provider: {profile?.state === 'ready' ? profile.data.provider ?? activity?.provider ?? 'Not reported' : activity?.provider ?? 'Not reported'}</p>
      <p>Skill count: {profile?.state === 'ready' && profile.data.skills ? profile.data.skills.length : activity?.skillCount ?? 'Not reported'}{profile?.state !== 'ready' && activity?.skillCount !== undefined ? ' (last Hermes roster count)' : ''}</p>
      <p>Most recent ordinary session: {activity?.lastSession?.title ?? 'Not reported'} · Last activity: {time(activity?.lastSession?.lastActive)}</p>
      {activity?.workerLastActive && <p>Recent background-worker activity: {time(activity.workerLastActive)} (not proof of a running foreground turn).</p>}
      <details><summary>Capabilities</summary>
        {!profile ? <p role="status">Loading…</p> : profile.state !== 'ready' ? <p role="status">{READ_STATE[profile.state]}</p> : <>
          <CapabilityList title="Skills" rows={profile.data.skills} /><CapabilityList title="Toolsets" rows={profile.data.toolsets} /><CapabilityList title="MCP servers" rows={profile.data.mcpServers} />
        </>}
        <p>Named profiles are not necessarily Bot Mode-managed. Clanker does not change Bot Mode metadata or SOUL.</p>
      </details>
      <details><summary>Recent ordinary conversations</summary><ReadSection value={details?.history} empty="No ordinary conversations in the recent window.">{(rows) => <ul>{rows.map((row, index) => <li key={index}>{row.title ?? 'Untitled'} · {time(row.lastActive)}</li>)}</ul>}</ReadSection></details>
      <h4>Routines / Scheduled tasks</h4><p>Owned and executed by Hermes for {assistant.displayName}. Read-only; Clanker never starts or schedules a job.</p>
      <ReadSection value={details?.routines} empty="No scheduled tasks reported for this profile.">{(jobs) => <ul key={revision}>{jobs.map((job) => <RoutineRuns key={job.id} assistantId={assistant.id} job={job} />)}</ul>}</ReadSection>
    </>}
  </section>;
}
