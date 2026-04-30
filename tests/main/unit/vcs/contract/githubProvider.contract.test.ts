import { describe, expect, beforeEach, afterEach, vi, it } from 'vitest';
import { startMockServer } from './httpContractHelpers';
import { createProviderContractTests } from './shared/contractTestFactory';

class TestableGitHubProvider {
  readonly apiBaseUrl: string;

  constructor(baseUrl: string) {
    this.apiBaseUrl = baseUrl;
  }

  async getPullRequestForBranch(owner: string, repo: string, branch: string, token?: string) {
    const headFilter = `${owner}:${branch}`;
    const url = `${this.apiBaseUrl}/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(headFilter)}&state=all`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const response = await fetch(url, { headers });
      if (!response.ok) return { exists: false };
      const prs = await response.json() as Array<{ number: number; state: string; merged_at: string | null }>;
      if (!prs?.length) return { exists: false };
      return { exists: true, number: prs[0].number, state: prs[0].merged_at ? 'merged' : prs[0].state };
    } catch {
      return { exists: false };
    }
  }

  async getChecksStatus(owner: string, repo: string, branch: string, token?: string) {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const refResponse = await fetch(`${this.apiBaseUrl}/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { headers });
      if (!refResponse.ok) return 'error' as const;
      const sha = (await refResponse.json() as { object: { sha: string } }).object.sha;
      const statusResponse = await fetch(`${this.apiBaseUrl}/repos/${owner}/${repo}/commits/${sha}/status`, { headers });
      if (!statusResponse.ok) return 'error' as const;
      const status = (await statusResponse.json() as { state: string }).state;
      if (status === 'success' || status === 'failure' || status === 'pending') return status;
      return 'error' as const;
    } catch {
      return 'error' as const;
    }
  }

  async validateToken(token: string) {
    const response = await fetch(`${this.apiBaseUrl}/user`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    return response.ok;
  }
}

describe('GitHub Provider HTTP Contract Tests', () => {
  let server: Awaited<ReturnType<typeof startMockServer>>;
  let provider: TestableGitHubProvider;

  beforeEach(async () => {
    server = await startMockServer([]);
    provider = new TestableGitHubProvider(server.baseUrl);
  });

  afterEach(async () => {
    await server.close();
    vi.restoreAllMocks();
  });

  createProviderContractTests(() => provider, {
    providerName: 'GitHub',
    setupRequestHandler: (handler) => {
      server.server.removeAllListeners('request');
      server.server.on('request', handler);
    },
    callGetPullRequestForBranch: (p, branch = 'branch', token) => (p as unknown as TestableGitHubProvider).getPullRequestForBranch('owner', 'repo', branch, token),
    callGetChecksStatus: (p, branch = 'branch', token) => (p as unknown as TestableGitHubProvider).getChecksStatus('owner', 'repo', branch, token),
    callValidateToken: (p, token) => (p as unknown as TestableGitHubProvider).validateToken(token),
    buildOpenPrResponse: () => JSON.stringify([{ number: 42, state: 'open', merged_at: null }]),
    buildMergedPrResponse: () => JSON.stringify([{ number: 42, state: 'closed', merged_at: '2024-01-01T00:00:00Z' }]),
    buildEmptyPrResponse: () => '[]',
    buildChecksSuccessResponseSequence: () => [
      { statusCode: 200, body: JSON.stringify({ object: { sha: 'abc123' } }) },
      { statusCode: 200, body: JSON.stringify({ state: 'success' }) },
    ],
    buildChecksFailureResponseSequence: () => [
      { statusCode: 200, body: JSON.stringify({ object: { sha: 'abc123' } }) },
      { statusCode: 200, body: JSON.stringify({ state: 'failure' }) },
    ],
    expectedBranchEncodingFragment: 'feature%2Fbranch-name',
  });

  it('uses Bearer auth header format', async () => {
    let auth = '';
    server.server.removeAllListeners('request');
    server.server.on('request', (req, res) => {
      auth = String(req.headers.authorization || '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
    });

    await provider.getPullRequestForBranch('owner', 'repo', 'branch', 'ghp_test123');
    expect(auth).toBe('Bearer ghp_test123');
  });
});
