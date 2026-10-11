import type { GitStatus } from './types';

const badges = { modified: 'M', added: 'A', deleted: 'D', untracked: '??', renamed: 'R' };
export function gitStatusBadge(status: GitStatus['status']) { return badges[status] || '?'; }
/** A partially staged path has two review entries, but is still one changed file. */
export function changedFileCount(changes: GitStatus[]) { return new Set(changes.map((change) => change.path)).size; }
