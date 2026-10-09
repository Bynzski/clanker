import { isIP } from 'node:net';

/** Main-owned approval policy. No renderer approval endpoint or hostname heuristics. */
const approved = new Set<string>();
let revision = 0;
export function canonicalGitLabOrigin(input: string): string | null {
  try {
    if (typeof input !== 'string' || input.length > 2048 || !/^https:\/\/[^/?#%\s]+\/?$/i.test(input)) return null;
    const url = new URL(input);
    const ip = isIP(url.hostname.replace(/^\[|\]$/g, ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash
      || (!ip && (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(url.hostname)
        || url.hostname.split('.').some((label) => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-'))))
      || url.hostname.length > 253) return null;
    return url.origin;
  } catch { return null; }
}
export function replaceApprovedGitLabOrigins(origins: string[]): void {
  approved.clear();
  for (const origin of origins.length <= 16 ? origins : []) {
    const valid = canonicalGitLabOrigin(origin);
    if (valid && valid !== 'https://gitlab.com') approved.add(valid);
  }
  revision++;
}
export function approvedGitLabOrigins(): string[] { return [...approved]; }
export function isApprovedGitLabOrigin(origin: string): boolean {
  return origin === 'https://gitlab.com' || approved.has(origin);
}
export function resolveGitLabSshOrigin(host: string): string | null {
  if (host === 'gitlab.com') return 'https://gitlab.com';
  const matches = [...approved].filter((origin) => new URL(origin).hostname === host);
  return matches.length === 1 ? matches[0] : null;
}
export function instancePolicyRevision(): number { return revision; }
