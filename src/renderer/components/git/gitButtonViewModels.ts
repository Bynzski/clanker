import type { VcsProvider } from './types';

export function getStatusErrorMessage(statusErrorCode: string | null): string | null {
  switch (statusErrorCode) {
    case 'git-not-found':
      return 'Git is not installed or not found on PATH';
    case 'not-a-repo':
      return 'Not a git repository';
    default:
      return null;
  }
}

export function getUpstreamLabel(upstream: string | null, ahead: number, behind: number): string | null {
  if (!upstream) {
    return null;
  }
  if (ahead === 0 && behind === 0) {
    return 'up to date';
  }

  const parts: string[] = [];
  if (ahead > 0) {
    parts.push(`↑${ahead}`);
  }
  if (behind > 0) {
    parts.push(`↓${behind}`);
  }

  return parts.join(' ');
}

export function getProviderLabel(provider: VcsProvider): string {
  switch (provider) {
    case 'github':
      return 'GitHub';
    case 'bitbucket':
      return 'Bitbucket';
    case 'gitlab':
      return 'GitLab';
    default:
      return 'no remote';
  }
}
