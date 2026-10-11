import type { ReactNode } from 'react';
import type { AssistantRead } from '../../../../shared/types/assistantDetails';
import { FormMessage } from '../../ui/Field';
const READ_STATE = { offline: 'Offline — metadata unavailable.', unavailable: 'Profile or data is no longer available.', unsupported: 'Not supported by this Hermes version.', error: 'Could not read from Hermes. Try refreshing.' };
export function AssistantReadResult<T>({ value, children }: { value?: AssistantRead<T>; children: (data: T) => ReactNode }) {
  if (!value) return <FormMessage role="status">Loading…</FormMessage>;
  if (value.state !== 'ready') return <FormMessage variant={value.state === 'error' ? 'error' : 'description'} role={value.state === 'error' ? 'alert' : 'status'}>{READ_STATE[value.state]}</FormMessage>;
  return children(value.data);
}
export function AssistantReadList<T>({ value, empty, children }: { value?: AssistantRead<T[]>; empty: string; children: (data: T[]) => ReactNode }) {
  return <AssistantReadResult value={value}>{(rows) => rows.length ? children(rows) : <FormMessage>{empty}</FormMessage>}</AssistantReadResult>;
}
export function assistantTime(value?: number): string { return value ? new Date(value * 1000).toLocaleString(undefined, { timeZoneName: 'short' }) : 'Not reported'; }
/** Only offset-bearing ISO times are reformatted; unzoned/unknown backend text stays untouched. */
export function AssistantTimestamp({ value }: { value?: string }) {
  if (!value) return <>Not reported</>;
  const date = new Date(value);
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(date.getTime())) return <>{value}</>;
  return <time dateTime={value} title={value}>{date.toLocaleString(undefined, { timeZoneName: 'short' })}</time>;
}
