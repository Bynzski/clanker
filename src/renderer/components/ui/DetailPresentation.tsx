import type { ComponentProps, ReactNode } from 'react';
import './DetailPresentation.css';

/** Read-only label/value anatomy. Feature code owns values and provenance, not presentation geometry. */
export function DataList({ items, ...props }: ComponentProps<'dl'> & { items: { label: string; value: ReactNode }[] }) {
  return <dl {...props} className={`clanker-data-list ${props.className ?? ''}`}>{items.map(({ label, value }) =>
    <div className="clanker-data-row" key={label}><dt>{label}</dt><dd>{value ?? 'Not reported'}</dd></div>)}</dl>;
}
export function StatusLabel({ tone = 'neutral', ...props }: ComponentProps<'span'> & { tone?: 'neutral' | 'muted' | 'positive' }) {
  return <span {...props} className={`clanker-status-label ${props.className ?? ''}`} data-tone={tone} />;
}
export function DetailSection({ title, description, actions, children }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return <section className="clanker-detail-section"><div className="clanker-detail-heading"><h4>{title}</h4>{actions}</div>
    {description && <p className="clanker-detail-description">{description}</p>}{children}</section>;
}
export function DetailCard({ title, status, children }: { title: ReactNode; status?: ReactNode; children: ReactNode }) {
  return <article className="clanker-detail-card"><div className="clanker-detail-heading"><strong>{title}</strong>{status}</div>{children}</article>;
}
/** Native disclosure keeps its keyboard and expanded-state semantics; styling is shared. */
export function Disclosure({ title, children, ...props }: Omit<ComponentProps<'details'>, 'title'> & { title: ReactNode }) {
  return <details {...props} className={`clanker-disclosure ${props.className ?? ''}`}><summary>{title}</summary><div className="clanker-disclosure-body">{children}</div></details>;
}
