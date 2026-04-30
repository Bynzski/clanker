import { describe, expect, beforeEach, afterEach, vi, it } from 'vitest';
import { startMockServer } from './httpContractHelpers';
import { createProviderContractTests } from './shared/contractTestFactory';

class TestableGitLabProvider {
  readonly apiBaseUrl: string;

  constructor(baseUrl: string) {
    this.apiBaseUrl = baseUrl;
  }

  private getProjectId(owner: string, repo: string) {
    return encodeURIComponent(`${owner}/${repo}`);
  }

  private async fetchWithAuth<T>(endpoint: string, token: string) {
    try {
      const response = await fetch(`${this.apiBaseUrl}${endpoint}`, { headers: { 'PRIVATE-TOKEN': token, Accept: 'application/json' } });
      if (!response.ok) return { success: false as const };
      const text = await response.text();
      return { success: true as const, data: (text ? JSON.parse(text) : null) as T };
    } catch {
      return { success: false as const };
    }
  }

  private async fetchPublic<T>(endpoint: string) {
    try {
      const response = await fetch(`${this.apiBaseUrl}${endpoint}`, { headers: { Accept: 'application/json' } });
      if (!response.ok) return { success: false as const };
      const text = await response.text();
      return { success: true as const, data: (text ? JSON.parse(text) : null) as T };
    } catch {
      return { success: false as const };
    }
  }

  async getPullRequestForBranch(owner: string, repo: string, branch: string, token?: string) {
    const endpoint = `/projects/${this.getProjectId(owner, repo)}/merge_requests?source_branch=${encodeURIComponent(branch)}&state=opened&per_page=1`;
    const result = token ? await this.fetchWithAuth<Array<{ iid: number; state: string }>>(endpoint, token) : await this.fetchPublic<Array<{ iid: number; state: string }>>(endpoint);
    if (!result.success || !result.data?.length) return { exists: false };
    const mr = result.data[0];
    return { exists: true, number: mr.iid, state: mr.state === 'opened' ? 'open' : mr.state === 'merged' ? 'merged' : 'closed' };
  }

  async getChecksStatus(owner: string, repo: string, branch: string, token?: string) {
    const endpoint = `/projects/${this.getProjectId(owner, repo)}/pipelines?ref=${encodeURIComponent(branch)}&per_page=1`;
    const result = token ? await this.fetchWithAuth<Array<{ status: string }>>(endpoint, token) : await this.fetchPublic<Array<{ status: string }>>(endpoint);
    if (!result.success || !result.data?.length) return 'error' as const;
    const status = result.data[0].status;
    if (status === 'success') return 'success' as const;
    if (status === 'failed') return 'failure' as const;
    if (status === 'pending' || status === 'running' || status === 'manual') return 'pending' as const;
    return 'error' as const;
  }

  async validateToken(token: string) {
    const result = await this.fetchWithAuth('/user', token);
    return result.success;
  }
}

describe('GitLab Provider HTTP Contract Tests', () => {
  let server: Awaited<ReturnType<typeof startMockServer>>;
  let provider: TestableGitLabProvider;

  beforeEach(async () => {
    server = await startMockServer([]);
    provider = new TestableGitLabProvider(server.baseUrl);
  });

  afterEach(async () => {
    await server.close();
    vi.restoreAllMocks();
  });

  createProviderContractTests(() => provider, {
    providerName: 'GitLab',
    setupRequestHandler: (handler) => {
      server.server.removeAllListeners('request');
      server.server.on('request', handler);
    },
    callGetPullRequestForBranch: (p, branch = 'branch', token) => (p as unknown as TestableGitLabProvider).getPullRequestForBranch('owner', 'repo', branch, token),
    callGetChecksStatus: (p, branch = 'branch', token) => (p as unknown as TestableGitLabProvider).getChecksStatus('owner', 'repo', branch, token),
    callValidateToken: (p, token) => (p as unknown as TestableGitLabProvider).validateToken(token),
    buildOpenPrResponse: () => JSON.stringify([{ iid: 42, state: 'opened', merged_at: null }]),
    buildMergedPrResponse: () => JSON.stringify([{ iid: 42, state: 'merged', merged_at: '2024-01-01T00:00:00Z' }]),
    buildEmptyPrResponse: () => '[]',
    buildChecksSuccessResponseSequence: () => [
      { statusCode: 200, body: JSON.stringify([{ id: 1, status: 'success' }]) },
    ],
    buildChecksFailureResponseSequence: () => [
      { statusCode: 200, body: JSON.stringify([{ id: 1, status: 'failed' }]) },
    ],
    expectedBranchEncodingFragment: 'feature%2Fbranch-name',
  });

  it('uses PRIVATE-TOKEN auth header format', async () => {
    let token = '';
    server.server.removeAllListeners('request');
    server.server.on('request', (req, res) => {
      token = String(req.headers['private-token'] || '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 1 }));
    });

    await provider.validateToken('glpat-test123');
    expect(token).toBe('glpat-test123');
  });
});
