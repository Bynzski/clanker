import type { AssistantCapability, AssistantProfileDetails, AssistantRead } from '../../../../shared/types/assistantDetails';
import { DetailSection, Disclosure, StatusLabel } from '../../ui/DetailPresentation';
import { FormMessage } from '../../ui/Field';
import { AssistantReadResult } from './AssistantReadState';
function CapabilityList({ title, rows, countLabel = 'configured' }: { title: string; rows?: AssistantCapability[]; countLabel?: 'installed' | 'configured' }) {
  return <DetailSection title={`${title}${rows ? ` · ${rows.filter((row) => row.enabled === true).length} enabled / ${rows.length} ${countLabel}` : ''}`}>
    {!rows ? <FormMessage>Not reported</FormMessage> : !rows.length ? <FormMessage>None configured</FormMessage> :
      <ul className="assistant-capabilities-list">{rows.map((row, index) => <li key={`${row.name}-${index}`}><span>{row.name}</span>
        <StatusLabel tone={row.enabled === true ? 'positive' : 'muted'}>{row.enabled === true ? 'Enabled' : row.enabled === false ? 'Disabled' : 'State not reported'}</StatusLabel></li>)}</ul>}
  </DetailSection>;
}
export function AssistantCapabilities({ profile }: { profile?: AssistantRead<AssistantProfileDetails> }) {
  return <Disclosure title="Capabilities"><AssistantReadResult value={profile}>{(data) => <>
    <CapabilityList title="Skills" rows={data.skills} countLabel="installed" /><CapabilityList title="Toolsets" rows={data.toolsets} /><CapabilityList title="MCP servers" rows={data.mcpServers} />
  </>}</AssistantReadResult><FormMessage>Named profiles are not necessarily Bot Mode-managed. Clanker does not change Bot Mode metadata or SOUL.</FormMessage></Disclosure>;
}
