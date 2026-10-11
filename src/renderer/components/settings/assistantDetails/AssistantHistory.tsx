import type { AssistantDetails } from '../../../../shared/types/assistantDetails';
import { DataList, DetailCard, Disclosure } from '../../ui/DetailPresentation';
import { AssistantReadList, assistantTime } from './AssistantReadState';
export function AssistantHistory({ history }: { history?: AssistantDetails['history'] }) {
  return <Disclosure title="Recent ordinary conversations"><AssistantReadList value={history} empty="No ordinary conversations in the recent window.">
    {(rows) => <ul className="assistant-detail-cards">{rows.map((row, index) => <li key={index}><DetailCard title={row.title ?? 'Untitled'}>
      <DataList items={[{ label: 'Last activity', value: assistantTime(row.lastActive) }]} />
    </DetailCard></li>)}</ul>}
  </AssistantReadList></Disclosure>;
}
