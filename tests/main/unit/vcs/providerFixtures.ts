import { vi } from 'vitest';
import type { ProviderContext } from '../../../../src/main/vcs/types';
export const SHA = 'a'.repeat(40);
export const OTHER_SHA = 'b'.repeat(40);
export const branch = 'feature/topic';
export function context(provider: ProviderContext['provider']): ProviderContext {
  return { provider, owner: 'owner', repo: 'repo', baseUrl: provider === 'github' ? 'https://github.com'
    : provider === 'gitlab' ? 'https://gitlab.com' : 'https://bitbucket.org', defaultBranch: '', headSha: SHA };
}
export function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(value), { status, headers });
}
export function installFetch(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const fetch = vi.fn((url: string, init?: RequestInit) => Promise.resolve(handler(new URL(url), init)));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const githubReviewRequest = { requested_reviewers: [], requested_teams: [] };
export function githubRepoResponse(url: URL, repo: unknown = githubRepo): Response {
  return json(/\/pulls\/\d+$/.test(url.pathname) ? githubReviewRequest : repo);
}
export const githubRepo = { full_name: 'owner/repo', default_branch: 'trunk', fork: false };
export function githubPr(number = 7, state = 'open', sha = SHA) {
  return { number, state, merged_at: null, title: 'Change', draft: false, user: { login: 'author' }, html_url: `https://github.com/owner/repo/pull/${number}`,
    head: { ref: branch, sha, repo: { full_name: 'owner/repo' } }, base: { repo: { full_name: 'owner/repo' } } };
}
export const gitlabRepo = { id: 1, default_branch: 'trunk' };
export function gitlabMr(iid = 7, state = 'opened', sha = SHA) {
  return { iid, id: iid + 100, state, title: 'Change', author: { username: 'author' }, web_url: `https://gitlab.com/owner/repo/-/merge_requests/${iid}`,
    source_branch: branch, source_project_id: 1, target_project_id: 1, sha, draft: false };
}
export const bitbucketRepo = { full_name: 'owner/repo', mainbranch: { name: 'trunk' } };
export function bitbucketPr(id = 7, state = 'OPEN', sha = SHA) {
  return { id, state, title: 'Change', author: { nickname: 'author' }, destination: { repository: { full_name: 'owner/repo' } }, links: { html: { href: `https://bitbucket.org/owner/repo/pull-requests/${id}` } },
    source: { branch: { name: branch }, repository: { full_name: 'owner/repo' }, commit: { hash: sha } } };
}
