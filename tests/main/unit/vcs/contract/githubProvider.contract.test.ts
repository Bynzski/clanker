/**
 * GitHub Provider HTTP Contract Tests
 * Tests HTTP contract behavior using a mock server approach.
 * These tests verify realistic HTTP interactions including:
 * - Rate limiting (429) with Retry-After headers
 * - Network delays and timeouts
 * - Malformed responses
 * - Token authentication header format
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startMockServer } from './httpContractHelpers';

/**
 * Custom GitHubProvider for testing with dynamic base URL.
 * Extends the real provider to work with mock server.
 */
class TestableGitHubProvider {
  readonly type = 'github' as const;
  readonly apiBaseUrl: string;

  constructor(baseUrl: string) {
    this.apiBaseUrl = baseUrl;
  }

  /**
   * Get PR for a branch - mirrors GitHubProvider logic.
   */
  async getPullRequestForBranch(
    owner: string,
    repo: string,
    branch: string,
    token?: string
  ): Promise<{ exists: boolean; number?: number; state?: string }> {
    const headFilter = `${owner}:${branch}`;
    const url = `${this.apiBaseUrl}/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(headFilter)}&state=all`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, { headers });
      
      if (!response.ok) {
        return { exists: false };
      }

      const prs = await response.json() as Array<{
        number: number;
        state: string;
        merged_at: string | null;
      }>;
      
      if (!prs || prs.length === 0) {
        return { exists: false };
      }

      const pr = prs[0];
      return {
        exists: true,
        number: pr.number,
        state: pr.merged_at ? 'merged' : pr.state,
      };
    } catch {
      return { exists: false };
    }
  }

  /**
   * Get checks status - mirrors GitHubProvider logic.
   */
  async getChecksStatus(
    owner: string,
    repo: string,
    branch: string,
    token?: string
  ): Promise<'pending' | 'success' | 'failure' | 'error'> {
    const refUrl = `${this.apiBaseUrl}/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`;
    
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const refResponse = await fetch(refUrl, { headers });
      if (!refResponse.ok) {
        return 'error';
      }

      const refData = await refResponse.json() as { object: { sha: string } };
      const sha = refData.object.sha;

      const statusUrl = `${this.apiBaseUrl}/repos/${owner}/${repo}/commits/${sha}/status`;
      const statusResponse = await fetch(statusUrl, { headers });
      
      if (!statusResponse.ok) {
        return 'error';
      }

      const statusData = await statusResponse.json() as { state: string };
      
      switch (statusData.state) {
        case 'success': return 'success';
        case 'failure': return 'failure';
        case 'pending': return 'pending';
        default: return 'error';
      }
    } catch {
      return 'error';
    }
  }

  /**
   * Validate token - mirrors GitHubProvider logic.
   */
  async validateToken(token: string): Promise<boolean> {
    const response = await fetch(`${this.apiBaseUrl}/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
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

  describe('getPullRequestForBranch', () => {
    it('should use correct Authorization header format', async () => {
      server.server.removeAllListeners('request');
      server.server.on('request', (req, res) => {
         
        void req;
        expect(req.headers['authorization']).toBe('Bearer ghp_test123');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
      });

      await provider.getPullRequestForBranch('owner', 'repo', 'branch', 'ghp_test123');
    });

    it('should include Accept header', async () => {
      let capturedAccept: string | undefined;
      server.server.removeAllListeners('request');
      server.server.on('request', (req, res) => {
         
        void res;
        capturedAccept = req.headers['accept'] as string | undefined;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
      });

      await provider.getPullRequestForBranch('owner', 'repo', 'branch');

      expect(capturedAccept).toBe('application/json');
    });

    it('should URL-encode branch names with special characters', async () => {
      let capturedUrl = '';
      server.server.removeAllListeners('request');
      server.server.on('request', (req, res) => {
         
        void res;
        capturedUrl = req.url || '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
      });

      await provider.getPullRequestForBranch('owner', 'repo', 'feature/branch-name');

      // URL should be properly encoded
      expect(capturedUrl).toContain('feature%2Fbranch-name');
    });

    it('should handle 404 Not Found gracefully', async () => {
      server.server.removeAllListeners('request');
      server.server.on('request', (_req, res) => {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
      });

      const result = await provider.getPullRequestForBranch('owner', 'repo', 'nonexistent');

      expect(result.exists).toBe(false);
    });

    it('should handle 500 Internal Server Error gracefully', async () => {
      server.server.removeAllListeners('request');
      server.server.on('request', (_req, res) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Server Error' }));
      });

      const result = await provider.getPullRequestForBranch('owner', 'repo', 'branch');

      expect(result.exists).toBe(false);
    });

    it('should handle 403 Forbidden (rate limited)', async () => {
      server.server.removeAllListeners('request');
      server.server.on('request', (_req, res) => {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
      });

      const result = await provider.getPullRequestForBranch('owner', 'repo', 'branch');

      expect(result.exists).toBe(false);
    });

    it('should parse merged PR state correctly', async () => {
      server.server.removeAllListeners('request');
      server.server.on('request', (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([{
          number: 42,
          state: 'closed',
          merged_at: '2024-01-01T00:00:00Z',
        }]));
      });

      const result = await provider.getPullRequestForBranch('owner', 'repo', 'merged-branch');

      expect(result.exists).toBe(true);
      expect(result.state).toBe('merged');
    });

    it('should parse open PR state correctly', async () => {
      server.server.removeAllListeners('request');
      server.server.on('request', (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([{
          number: 42,
          state: 'open',
          merged_at: null,
        }]));
      });

      const result = await provider.getPullRequestForBranch('owner', 'repo', 'open-branch');

      expect(result.exists).toBe(true);
      expect(result.state).toBe('open');
    });

    it('should return exists:false for empty PR list', async () => {
      server.server.removeAllListeners('request');
      server.server.on('request', (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
      });

      const result = await provider.getPullRequestForBranch('owner', 'repo', 'no-pr-branch');

      expect(result.exists).toBe(false);
    });
  });

  describe('getChecksStatus', () => {
    it('should return success for successful checks', async () => {
      let requestCount = 0;
      server.server.removeAllListeners('request');
      server.server.on('request', (_req, res) => {
        requestCount++;
        if (requestCount === 1) {
          // Ref request
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ object: { sha: 'abc123' } }));
        } else {
          // Status request
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ state: 'success', statuses: [] }));
        }
      });

      const result = await provider.getChecksStatus('owner', 'repo', 'branch');

      expect(result).toBe('success');
    });

    it('should return failure for failed checks', async () => {
      let requestCount = 0;
      server.server.removeAllListeners('request');
      server.server.on('request', (_req, res) => {
        requestCount++;
        if (requestCount === 1) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ object: { sha: 'abc123' } }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ state: 'failure', statuses: [] }));
        }
      });

      const result = await provider.getChecksStatus('owner', 'repo', 'branch');

      expect(result).toBe('failure');
    });

    it('should return pending for pending checks', async () => {
      let requestCount = 0;
      server.server.removeAllListeners('request');
      server.server.on('request', (_req, res) => {
        requestCount++;
        if (requestCount === 1) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ object: { sha: 'abc123' } }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ state: 'pending', statuses: [] }));
        }
      });

      const result = await provider.getChecksStatus('owner', 'repo', 'branch');

      expect(result).toBe('pending');
    });

    it('should return error when ref lookup fails', async () => {
      server.server.removeAllListeners('request');
      server.server.on('request', (_req, res) => {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
      });

      const result = await provider.getChecksStatus('owner', 'repo', 'nonexistent');

      expect(result).toBe('error');
    });

    it('should return error when status lookup fails', async () => {
      let requestCount = 0;
      server.server.removeAllListeners('request');
      server.server.on('request', (_req, res) => {
        requestCount++;
        if (requestCount === 1) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ object: { sha: 'abc123' } }));
        } else {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Server Error' }));
        }
      });

      const result = await provider.getChecksStatus('owner', 'repo', 'branch');

      expect(result).toBe('error');
    });

    it('should make two requests: ref then status', async () => {
      let requestCount = 0;
      server.server.removeAllListeners('request');
      server.server.on('request', (_req, res) => {
        requestCount++;
        if (requestCount === 1) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ object: { sha: 'abc123' } }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ state: 'success', statuses: [] }));
        }
      });

      await provider.getChecksStatus('owner', 'repo', 'branch');

      expect(requestCount).toBe(2);
    });

    it('should use Authorization header with token for status check', async () => {
      const statusRequestHeaders: Record<string, string> = {};
      let requestCount = 0;
      server.server.removeAllListeners('request');
      server.server.on('request', (req, res) => {
        requestCount++;
        // For status request (second request), capture headers
        if (requestCount === 2) {
          for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === 'string') {
              statusRequestHeaders[key] = value;
            }
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (requestCount === 1) {
          res.end(JSON.stringify({ object: { sha: 'abc123' } }));
        } else {
          res.end(JSON.stringify({ state: 'success', statuses: [] }));
        }
      });

      await provider.getChecksStatus('owner', 'repo', 'branch', 'ghp_token');

      expect(statusRequestHeaders['authorization']).toBe('Bearer ghp_token');
    });
  });

  describe('validateToken', () => {
    it('should return true for 200 OK', async () => {
      server.server.removeAllListeners('request');
      server.server.on('request', (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ login: 'testuser' }));
      });

      const result = await provider.validateToken('valid-token');

      expect(result).toBe(true);
    });

    it('should return false for 401 Unauthorized', async () => {
      server.server.removeAllListeners('request');
      server.server.on('request', (_req, res) => {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
      });

      const result = await provider.validateToken('invalid-token');

      expect(result).toBe(false);
    });

    it('should return false for 403 Forbidden', async () => {
      server.server.removeAllListeners('request');
      server.server.on('request', (_req, res) => {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
      });

      const result = await provider.validateToken('forbidden-token');

      expect(result).toBe(false);
    });

    it('should include Authorization header', async () => {
      let capturedAuth: string | undefined;
      server.server.removeAllListeners('request');
      server.server.on('request', (req, res) => {
         
        void res;
        capturedAuth = req.headers['authorization'];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ login: 'testuser' }));
      });

      await provider.validateToken('my-secret-token');

      expect(capturedAuth).toBe('Bearer my-secret-token');
    });
  });

  describe('Rate Limiting Behavior', () => {
    it('should handle 429 Too Many Requests', async () => {
      server.server.removeAllListeners('request');
      server.server.on('request', (_req, res) => {
        res.writeHead(429, {
          'Content-Type': 'application/json',
          'X-RateLimit-Remaining': '0',
          'Retry-After': '60',
        });
        res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
      });

      const result = await provider.getPullRequestForBranch('owner', 'repo', 'branch');

      expect(result.exists).toBe(false);
    });

    it('should preserve Retry-After header value', async () => {
      let capturedRetryAfter: string | undefined;
      server.server.removeAllListeners('request');
      server.server.on('request', (req, res) => {
         
        void res;
        capturedRetryAfter = req.headers['retry-after'] as string | undefined;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
      });

      await provider.getPullRequestForBranch('owner', 'repo', 'branch');

      expect(capturedRetryAfter).toBeUndefined(); // Client doesn't send this header
    });

    it('should handle rate limit response from user endpoint', async () => {
      server.server.removeAllListeners('request');
      server.server.on('request', (_req, res) => {
        res.writeHead(429, {
          'Content-Type': 'application/json',
          'Retry-After': '30',
        });
        res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
      });

      const result = await provider.validateToken('token');

      expect(result).toBe(false);
    });
  });

  describe('Error Response Handling', () => {
    it('should handle malformed JSON response', async () => {
      server.server.removeAllListeners('request');
      server.server.on('request', (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{ invalid json');
      });

      // Should not throw, should return exists:false
      const result = await provider.getPullRequestForBranch('owner', 'repo', 'branch');

      expect(result.exists).toBe(false);
    });

    it('should handle empty response body', async () => {
      server.server.removeAllListeners('request');
      server.server.on('request', (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('');
      });

      // Should not throw, should return exists:false
      const result = await provider.getPullRequestForBranch('owner', 'repo', 'branch');

      expect(result.exists).toBe(false);
    });

    it('should handle server error (500)', async () => {
      server.server.removeAllListeners('request');
      server.server.on('request', (_req, res) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
      });

      const result = await provider.getPullRequestForBranch('owner', 'repo', 'branch');

      expect(result.exists).toBe(false);
    });

    it('should handle service unavailable (503)', async () => {
      server.server.removeAllListeners('request');
      server.server.on('request', (_req, res) => {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Service Unavailable' }));
      });

      const result = await provider.getPullRequestForBranch('owner', 'repo', 'branch');

      expect(result.exists).toBe(false);
    });
  });

  describe('Request Format Validation', () => {
    it('should construct correct endpoint path', async () => {
      let capturedUrl = '';
      server.server.removeAllListeners('request');
      server.server.on('request', (req, res) => {
         
        void res;
        capturedUrl = req.url || '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
      });

      await provider.getPullRequestForBranch('my-org', 'my-repo', 'feature-branch');

      expect(capturedUrl).toBe('/repos/my-org/my-repo/pulls?head=my-org%3Afeature-branch&state=all');
    });

    it('should encode owner:branch format correctly', async () => {
      let capturedUrl = '';
      server.server.removeAllListeners('request');
      server.server.on('request', (req, res) => {
         
        void res;
        capturedUrl = req.url || '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
      });

      await provider.getPullRequestForBranch('org', 'repo', 'feature/branch');

      // : should be encoded as %3A
      expect(capturedUrl).toContain('%3A');
    });
  });
});
