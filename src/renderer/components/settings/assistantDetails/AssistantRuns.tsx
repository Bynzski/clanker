import type { AssistantRead, AssistantRun } from '../../../../shared/types/assistantDetails';
import { DataList, DetailCard } from '../../ui/DetailPresentation';
import { FormMessage } from '../../ui/Field';
import { AssistantReadList, assistantTime } from './AssistantReadState';
export function AssistantRuns({ runs }: { runs?: AssistantRead<AssistantRun[]> }) {
  if (runs?.state === 'unavailable') return <FormMessage role="status">Run history unavailable or profile ownership could not be confirmed. This Hermes API may omit the owning profile; Clanker will not show ambiguous records.</FormMessage>;
  return <AssistantReadList value={runs} empty="No recent execution records available. This does not prove the task never ran.">{(rows) => <ul className="assistant-detail-cards">{rows.map((run, index) => <li key={index}>
    <DetailCard title={run.source === 'cron_output' ? 'Script execution record' : 'Agent execution record'}><DataList items={[
      { label: 'Record type', value: run.source === 'cron_output' ? 'Script / output record' : 'Agent session' },
      { label: run.source === 'cron_output' ? 'Record timestamp' : 'Started', value: assistantTime(run.startedAt) },
      { label: run.source === 'cron_output' ? 'Record end timestamp' : 'Ended', value: assistantTime(run.endedAt) },
      { label: 'Execution result', value: 'Unknown — no structured per-run result reported' },
    ]} /><FormMessage>An ended session does not prove success. Native titles and output previews are withheld because they can contain prompts or secrets.</FormMessage>
    </DetailCard>
  </li>)}</ul>}</AssistantReadList>;
}
