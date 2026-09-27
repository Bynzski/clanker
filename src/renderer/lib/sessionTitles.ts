import type { HarnessSession } from '../../shared/types/session';

/** Give identical harness titles a visible, stable distinction in history. */
export function getSessionDisplayTitles(sessions: HarnessSession[]): Map<string, string> {
  const titleCounts = new Map<string, number>();
  const datedTitleCounts = new Map<string, number>();
  const titles = new Map<string, string>();

  const dateLabelFor = (timestamp: number): string => {
    const date = new Date(timestamp);
    return timestamp > 0 && !Number.isNaN(date.getTime())
      ? date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : 'Undated';
  };

  for (const session of sessions) {
    const title = session.title.trim().replace(/\s+/g, ' ');
    const key = `${session.harness}\0${title.toLocaleLowerCase()}`;
    titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
    const datedKey = `${key}\0${dateLabelFor(session.timestamp)}`;
    datedTitleCounts.set(datedKey, (datedTitleCounts.get(datedKey) ?? 0) + 1);
  }

  for (const session of sessions) {
    const title = session.title.trim().replace(/\s+/g, ' ');
    const key = `${session.harness}\0${title.toLocaleLowerCase()}`;
    let displayTitle = title;
    if ((titleCounts.get(key) ?? 0) > 1) {
      const dateLabel = dateLabelFor(session.timestamp);
      const displayKey = `${key}\0${dateLabel}`;
      const suffix = (datedTitleCounts.get(displayKey) ?? 0) > 1
        ? ` · ${session.id.slice(-6)}` : '';
      displayTitle = `${dateLabel}${suffix} · ${title}`;
    }
    titles.set(`${session.harness}\0${session.id}`, displayTitle);
  }

  return titles;
}
