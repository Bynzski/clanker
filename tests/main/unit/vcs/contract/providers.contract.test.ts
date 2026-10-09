import { afterEach, describe, expect, it, vi } from 'vitest';
import { startMockServer, type MockEndpointConfig } from './httpContractHelpers';
import { GitHubProvider } from '../../../../../src/main/vcs/providers/githubProvider';
import { GitLabProvider } from '../../../../../src/main/vcs/providers/gitlabProvider';
import { BitbucketProvider } from '../../../../../src/main/vcs/providers/bitbucketProvider';
import { withVcsBudget } from '../../../../../src/main/vcs/requestBudget';
import { context, SHA, branch } from '../providerFixtures';
const nativeFetch = globalThis.fetch;
let server: Awaited<ReturnType<typeof startMockServer>> | undefined;
async function transport(endpoints: MockEndpointConfig[]) {
  server = await startMockServer(endpoints);
  // Test-only network routing. The real providers still validate their original HTTPS URL.
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const target = new URL(url);
    if (!['https://api.github.com', 'https://gitlab.com', 'https://api.bitbucket.org'].includes(target.origin)) throw new Error('Unexpected API origin');
    return nativeFetch(`${server!.baseUrl}${target.pathname}${target.search}`, init);
  });
  return server;
}
afterEach(async () => { vi.unstubAllGlobals(); server?.server.closeAllConnections(); await server?.close(); server = undefined; });
describe('real production providers over native HTTP fetch', () => {
  it.each([
    [new GitHubProvider(), '/user', 'authorization', 'Bearer secret', { id: 1, login: 'person' }],
    [new GitLabProvider(), '/api/v4/user', 'private-token', 'secret', { id: 1, username: 'person' }],
    [new BitbucketProvider(), '/2.0/user', 'authorization', 'Bearer secret', { uuid: '{1234}' }],
  ] as const)('uses the native request contract for %s', async (provider, path, header, value, identity) => {
    const server = await transport([{ path, body: JSON.stringify(identity) }]);
    expect(await provider.validateToken('secret')).toBe(true);
    expect(server.capturedRequests).toHaveLength(1); expect(server.capturedRequests[0]).toMatchObject({ method: 'GET', headers: { [header]: value } });
  });
  it('rejects redirects without sending a token to the destination', async () => {
    const server = await transport([{ path: '/user', statusCode: 302, headers: { location: '/steal' }, body: '' }, { path: '/steal', body: '{"id":1}' }]);
    expect(await withVcsBudget(() => new GitHubProvider().validateToken('secret'), { timeoutMs: 150 })).toBe(false);
    expect(server.capturedRequests.every((request) => request.url === '/user')).toBe(true);
  });
  it('reads the real Bitbucket SHA status envelope', async () => {
    const server = await transport([{ path: `/2.0/repositories/owner/repo/commit/${SHA}/statuses?pagelen=100`, body: JSON.stringify({ values: [{ key: 'ci', state: 'FAILED' }] }) }]);
    expect(await new BitbucketProvider().getChecksSummary(context('bitbucket'), branch, 'secret')).toMatchObject({ state: 'failure' });
    expect(server.capturedRequests[0].url).not.toContain(`/commit/${branch}/`);
  });
  it('enforces the actual body-size cap over HTTP', async () => {
    await transport([{ path: '/user', body: '{}', responseSize: 2 * 1024 * 1024 + 1 }]);
    expect(await new GitHubProvider().validateToken('secret')).toBe(false);
  });
});
