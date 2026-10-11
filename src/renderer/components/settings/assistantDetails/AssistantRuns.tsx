import type { AssistantRead, AssistantRun } from '../../../../shared/types/assistantDetails';
import { DataList, DetailCard } from '../../ui/DetailPresentation';
import { FormMessage } from '../../ui/Field';
import { AssistantReadList, assistantTime } from './AssistantReadState';
export function AssistantRuns({ runs }: { runs?: AssistantRead<AssistantRun[]> }) {
  return <AssistantReadList value={runs} empty="No recent runs reported.">{(rows) => <ul className="assistant-detail-cards">{rows.map((run, index) => <li key={index}>
    <DetailCard title={run.title ?? 'Untitled run'}><DataList items={[
      { label: 'Record type', value: run.source === 'cron_output' ? 'Script / output record' : 'Agent session' },
      { label: 'Started', value: assistantTime(run.startedAt) }, { label: 'Ended', value: assistantTime(run.endedAt) },
    ]} /><FormMessage>Run result is not independently reported; an ended session does not prove success.</FormMessage>
      {run.preview && <pre className="assistant-output-preview" aria-label="Hermes output preview">{run.preview}</pre>}
    </DetailCard>
  </li>)}</ul>}</AssistantReadList>;
}
