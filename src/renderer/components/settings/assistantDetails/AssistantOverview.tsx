import type { HermesAssistant } from '../../../../shared/types/assistants';
import type { AssistantProfileDetails, AssistantRead } from '../../../../shared/types/assistantDetails';
import { DataList, DetailSection } from '../../ui/DetailPresentation';
import { FormMessage } from '../../ui/Field';
import { assistantTime } from './AssistantReadState';
export function AssistantOverview({ assistant, profile }: { assistant: HermesAssistant; profile?: AssistantRead<AssistantProfileDetails> }) {
  const activity = assistant.activity;
  const data = profile?.state === 'ready' ? profile.data : undefined;
  const skills = data?.skills?.length ?? activity?.skillCount;
  return <DetailSection title="Overview · Hermes-reported"><DataList items={[
    { label: 'Model', value: data?.model ?? activity?.model }, { label: 'Provider', value: data?.provider ?? activity?.provider },
    { label: 'Skill count', value: skills !== undefined ? `${skills}${!data?.skills ? ' (last Hermes roster count)' : ''}` : undefined },
    { label: 'Most recent ordinary session', value: activity?.lastSession?.title },
    { label: 'Last activity', value: assistantTime(activity?.lastSession?.lastActive) },
    ...(activity?.workerLastActive ? [{ label: 'Background-worker activity', value: assistantTime(activity.workerLastActive) }] : []),
  ]} />{activity?.workerLastActive && <FormMessage>Background activity is not proof of a running foreground turn.</FormMessage>}</DetailSection>;
}
