import type http from 'http';
import { describe, it, expect } from 'vitest';

export interface PullRequestResult {
  exists: boolean;
  number?: number;
  state?: string;
}

export type ChecksResult = 'pending' | 'success' | 'failure' | 'error';

export interface ContractFactoryConfig<TProvider> {
  providerName: string;
  setupRequestHandler: (handler: http.RequestListener) => void;
  callGetPullRequestForBranch: (provider: TProvider, branch?: string, token?: string) => Promise<PullRequestResult>;
  callGetChecksStatus: (provider: TProvider, branch?: string, token?: string) => Promise<ChecksResult>;
  callValidateToken: (provider: TProvider, token: string) => Promise<boolean>;
  buildOpenPrResponse: () => string;
  buildMergedPrResponse?: () => string;
  buildEmptyPrResponse: () => string;
  buildChecksSuccessResponseSequence: () => Array<{ statusCode: number; body: string }>;
  buildChecksFailureResponseSequence?: () => Array<{ statusCode: number; body: string }>;
  expectedBranchEncodingFragment: string;
  expectedChecksSuccessResult?: ChecksResult;
}

export function createProviderContractTests<TProvider>(
  getProvider: () => TProvider,
  config: ContractFactoryConfig<TProvider>
): void {
  describe(`${config.providerName} shared contract`, () => {
    describe('getPullRequestForBranch', () => {
      it('URL-encodes branch names with special characters', async () => {
        let capturedUrl = '';
        config.setupRequestHandler((req, res) => {
          capturedUrl = req.url || '';
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(config.buildEmptyPrResponse());
        });

        await config.callGetPullRequestForBranch(getProvider(), 'feature/branch-name');
        expect(capturedUrl).toContain(config.expectedBranchEncodingFragment);
      });

      it('returns exists:false for 404', async () => {
        config.setupRequestHandler((_req, res) => {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not Found' }));
        });

        const result = await config.callGetPullRequestForBranch(getProvider());
        expect(result.exists).toBe(false);
      });

      it('returns exists:false for 500', async () => {
        config.setupRequestHandler((_req, res) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Server Error' }));
        });

        const result = await config.callGetPullRequestForBranch(getProvider());
        expect(result.exists).toBe(false);
      });

      it('returns exists:false for empty PR list', async () => {
        config.setupRequestHandler((_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(config.buildEmptyPrResponse());
        });

        const result = await config.callGetPullRequestForBranch(getProvider());
        expect(result.exists).toBe(false);
      });

      it('parses open PR state', async () => {
        config.setupRequestHandler((_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(config.buildOpenPrResponse());
        });

        const result = await config.callGetPullRequestForBranch(getProvider());
        expect(result.exists).toBe(true);
        expect(result.state).toBe('open');
      });

      if (config.buildMergedPrResponse) {
        it('parses merged PR state', async () => {
          config.setupRequestHandler((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(config.buildMergedPrResponse!());
          });

          const result = await config.callGetPullRequestForBranch(getProvider());
          expect(result.exists).toBe(true);
          expect(result.state).toBe('merged');
        });
      }

      it('handles malformed JSON gracefully', async () => {
        config.setupRequestHandler((_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{ invalid json');
        });

        const result = await config.callGetPullRequestForBranch(getProvider());
        expect(result.exists).toBe(false);
      });
    });

    describe('getChecksStatus', () => {
      it('returns success for successful checks', async () => {
        const sequence = config.buildChecksSuccessResponseSequence();
        let requestCount = 0;
        config.setupRequestHandler((_req, res) => {
          const current = sequence[Math.min(requestCount, sequence.length - 1)];
          requestCount += 1;
          res.writeHead(current.statusCode, { 'Content-Type': 'application/json' });
          res.end(current.body);
        });

        const result = await config.callGetChecksStatus(getProvider());
        expect(result).toBe(config.expectedChecksSuccessResult ?? 'success');
      });

      if (config.buildChecksFailureResponseSequence) {
        it('returns failure for failed checks', async () => {
          const sequence = config.buildChecksFailureResponseSequence!();
          let requestCount = 0;
          config.setupRequestHandler((_req, res) => {
            const current = sequence[Math.min(requestCount, sequence.length - 1)];
            requestCount += 1;
            res.writeHead(current.statusCode, { 'Content-Type': 'application/json' });
            res.end(current.body);
          });

          const result = await config.callGetChecksStatus(getProvider());
          expect(result).toBe('failure');
        });
      }

      it('returns error for 404', async () => {
        config.setupRequestHandler((_req, res) => {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not Found' }));
        });

        const result = await config.callGetChecksStatus(getProvider());
        expect(result).toBe('error');
      });
    });

    describe('validateToken', () => {
      it('returns true for 200', async () => {
        config.setupRequestHandler((_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        });

        await expect(config.callValidateToken(getProvider(), 'valid-token')).resolves.toBe(true);
      });

      it('returns false for 401', async () => {
        config.setupRequestHandler((_req, res) => {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
        });

        await expect(config.callValidateToken(getProvider(), 'invalid-token')).resolves.toBe(false);
      });

      it('returns false for 403', async () => {
        config.setupRequestHandler((_req, res) => {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Forbidden' }));
        });

        await expect(config.callValidateToken(getProvider(), 'forbidden-token')).resolves.toBe(false);
      });
    });

    describe('rate limiting', () => {
      it('handles 429 responses', async () => {
        config.setupRequestHandler((_req, res) => {
          res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '30' });
          res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
        });

        const pr = await config.callGetPullRequestForBranch(getProvider());
        const validate = await config.callValidateToken(getProvider(), 'token');
        expect(pr.exists).toBe(false);
        expect(validate).toBe(false);
      });
    });
  });
}
