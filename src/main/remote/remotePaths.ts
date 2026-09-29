import * as path from 'node:path';

export function isPathContained(rootPath: string, candidatePath: string): boolean {
  if (!rootPath || !candidatePath) return false;
  const normRoot = path.posix.normalize(rootPath).replace(/\/+$/, '') || '/';
  const normCandidate = path.posix.normalize(candidatePath).replace(/\/+$/, '') || '/';
  if (!path.posix.isAbsolute(normCandidate)) return false;
  if (normRoot === normCandidate || normRoot === '/') return true;
  const relative = path.posix.relative(normRoot, normCandidate);
  return relative === '' || (!relative.startsWith('..') && !path.posix.isAbsolute(relative));
}
