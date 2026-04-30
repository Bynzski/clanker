import { describe, expect, beforeEach, afterEach, vi, it } from 'vitest';
import { startMockServer } from './httpContractHelpers';
import { createProviderContractTests } from './shared/contractTestFactory';

class TestableBitbucketProvider {
  readonly apiBaseUrl: string;

  constructor(baseUrl: string) {
    this.apiBaseUrl = baseUrl;
  }

  private async fetchWithAuth<T>(endpoint: string, token: string) {
    try {
      const response = await fetch(`${this.apiBaseUrl}${endpoint}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      if (!response.ok) return { success: false as const };
      return { success: true as const, data: await response.json() as T };
    } catch {
      return { success: false as const };
    }
  }

  private async fetchPublic<T>(endpoint: string) {
    try {
      const response = await fetch(`${this.apiBaseUrl}${endpoint}`, { headers: { Accept: 'application/json' } });
      if (!response.ok) return { success: false as const };
      return { success: true as const, data: await response.json() as T };
    } catch {
      return { success: false as const };
    }
  }

  async getPullRequestForBranch(workspace: string, repo: string, branch: string, token?: string) {
    const endpoint = `/repositories/${workspace}/${repo}/pullrequests?state=OPEN&source.branch.name=${encodeURIComponent(branch)}`;
    const result = token ? await this.fetchWithAuth<{ values?: Array<{ id: number; state: string }> }>(endpoint, token) : await this.fetchPublic<{ values?: Array<{ id: number; state: string }> }>(endpoint);
    if (!result.success || !result.data.values?.length) return { exists: false };
    const pr = result.data.values[0];
    const state = pr.state === 'OPEN' ? 'open' : pr.state === 'MERGED' ? 'merged' : 'closed';
    return { exists: true, number: pr.id, state };
  }

  async getChecksStatus(workspace: string, repo: string, branch: string, token?: string) {
    const endpoint = `/repositories/${workspace}/${repo}/pullrequests?state=OPEN&source.branch.name=${encodeURIComponent(branch)}`;
    const result = token ? await this.fetchWithAuth<{ values?: unknown[] }>(endpoint, token) : await this.fetchPublic<{ values?: unknown[] }>(endpoint);
    if (!result.success || !result.data.values?.length) return 'error' as const;
    return 'pending' as const;
  }

  async validateToken(token: string) {
    const result = await this.fetchWithAuth('/user', token);
    return result.success;
  }
}

describe('Bitbucket Provider HTTP Contract Tests', () => {
  let server: Awaited<ReturnType<typeof startMockServer>>;
  let provider: TestableBitbucketProvider;

  beforeEach(async () => {
    server = await startMockServer([]);
    provider = new TestableBitbucketProvider(server.baseUrl);
  });

  afterEach(async () => {
    await server.close();
    vi.restoreAllMocks();
  });

  createProviderContractTests(() => provider, {
    providerName: 'Bitbucket',
    setupRequestHandler: (handler) => {
      server.server.removeAllListeners('request');
      server.server.on('request', handler);
    },
    callGetPullRequestForBranch: (p, branch = 'branch', token) => (p as unknown as TestableBitbucketProvider).getPullRequestForBranch('workspace', 'repo', branch, token),
    callGetChecksStatus: (p, branch = 'branch', token) => (p as unknown as TestableBitbucketProvider).getChecksStatus('workspace', 'repo', branch, token),
    callValidateToken: (p, token) => (p as unknown as TestableBitbucketProvider).validateToken(token),
    buildOpenPrResponse: () => JSON.stringify({ values: [{ id: 123, state: 'OPEN' }] }),
    buildMergedPrResponse: () => JSON.stringify({ values: [{ id: 123, state: 'MERGED' }] }),
    buildEmptyPrResponse: () => JSON.stringify({ values: [] }),
    buildChecksSuccessResponseSequence: () => [
      { statusCode: 200, body: JSON.stringify({ values: [{ id: 123, state: 'OPEN' }] }) },
    ],
    expectedBranchEncodingFragment: 'feature%2Fbranch-name',
    expectedChecksSuccessResult: 'pending',
  });

  it('uses Bearer auth header format', async () => {
    let auth = '';
    server.server.removeAllListeners('request');
    server.server.on('request', (req, res) => {
      auth = String(req.headers.authorization || '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ account_id: 'abc123' }));
    });

    await provider.validateToken('bb_token_test123');
    expect(auth).toBe('Bearer bb_token_test123');
  });
});
