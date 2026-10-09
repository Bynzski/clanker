import { createHash } from 'node:crypto';
import { buildProviderContext } from './providerDetector';
import { withVcsBudget, type VcsRequestOptions } from './requestBudget';
import { getProviderInstance } from './providerRegistry';
import { getCredentialRevision, getProviderPat, hasStoredProviderPat } from '../credential/credentialService';
import { problem, unavailablePr } from './statusModel';
import { instancePolicyRevision } from './instancePolicy';
import type { CiSummary, ProviderContextResult, ReviewSummary, VcsRequestIdentity, VcsProblem } from './types';
export { getProviderDeepLinks, getDeepLinkUrl } from './providerDetector';

interface ContextOptions extends VcsRequestOptions { identity?: VcsRequestIdentity; headSha?: string; refresh?: boolean }
interface CacheEntry { promise: Promise<ProviderContextResult>; expires: number }
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5000;

/** No global polling. Cache only exact environment/checkout/ref/credential identities. */
export async function getProviderContext(remoteName: string, remoteUrl: string, branch: string,
  defaultBranch: string = '', options: ContextOptions = {}): Promise<ProviderContextResult> {
  const context = buildProviderContext(remoteName, remoteUrl, defaultBranch);
  if (!context) return { success: false, problem: problem('unsupported'), error: problem('unsupported').message, deepLinks: [] };
  context.headSha = options.identity?.headSha ?? options.headSha;
  const provider = getProviderInstance(context.provider, context.baseUrl);
  if (!provider) return { success: false, provider: context, problem: problem('unsupported'), error: problem('unsupported').message, deepLinks: [] };
  const stored = hasStoredProviderPat(context.provider, context.baseUrl);
  const credential = getProviderPat(context.provider, context.baseUrl);
  const token = credential.success ? credential.token : undefined;
  const key = createHash('sha256').update(JSON.stringify([options.identity, remoteName, remoteUrl, branch, context.headSha,
    context.defaultBranch, getCredentialRevision(), instancePolicyRevision(), token ?? '', stored])).digest('hex');
  const cacheable = !!options.identity && !options.signal && options.timeoutMs === undefined;
  if (cacheable && !options.refresh) {
    const existing = cache.get(key);
    if (existing && existing.expires > Date.now()) return existing.promise;
  }
  const operation = withVcsBudget(async (): Promise<ProviderContextResult> => {
    const unavailable = (error: VcsProblem): CiSummary => ({ state: 'unknown', sha: context.headSha, problem: error });
    let pullRequest = unavailablePr(problem('unknown'));
    let ci: CiSummary = unavailable(problem('unknown'));
    let review: ReviewSummary = { state: 'unknown', problem: problem('unknown') };
    try {
      if (stored && !token) {
        pullRequest = unavailablePr(problem('auth-required'));
        ci = unavailable(problem('auth-required'));
        review = { state: 'unknown', problem: problem('auth-required') };
      } else {
        context.defaultBranch = await provider.getDefaultBranch(context, token);
        pullRequest = await provider.getPullRequestForBranch(context, branch, token);
        context.pullRequestNumber = pullRequest.exists ? pullRequest.number : undefined;
        context.pullRequestRepositoryPath = pullRequest.exists ? pullRequest.repositoryPath : undefined;
        // CI is independently obtained for the actual checkout HEAD, even without a PR.
        [ci, review] = await Promise.all([
          provider.getChecksSummary(context, branch, token),
          pullRequest.exists && pullRequest.number ? provider.getReviewSummary(context, pullRequest.number, token)
            : Promise.resolve<ReviewSummary>({ state: pullRequest.outcome === 'none' ? 'none' : 'unknown', problem: pullRequest.problem }),
        ]);
      }
    } catch {
      // Preserve completed PR discovery when later calls fail or the budget expires.
      const error = problem('unknown');
      ci = unavailable(error);
      review = { state: 'unknown', problem: error };
    }
    const error = pullRequest.problem ?? ci.problem ?? review.problem;
    const fullPr = { ...pullRequest,
      checksStatus: ci.state === 'none' || ci.state === 'unknown' ? undefined : ci.state,
      reviewState: review.state === 'none' || review.state === 'unknown' ? undefined : review.state,
    };
    const deepLinks = provider.getDeepLinks(context, branch || undefined, pullRequest.exists ? pullRequest.number : undefined)
      .map((link) => link.type === 'pr' && pullRequest.url ? { ...link, url: pullRequest.url } : link);
    return { success: !error, provider: context, pullRequest: fullPr, ci, review, deepLinks,
      problem: error, error: error?.message, identity: options.identity,
      credential: { stored, decryptable: !!token,
        repositoryAccess: pullRequest.outcome === 'found' || pullRequest.outcome === 'none' ? 'available' : 'unavailable' } };
  }, options);
  if (!cacheable) return operation;
  for (const [oldKey, entry] of cache) if (entry.expires <= Date.now()) cache.delete(oldKey);
  while (cache.size >= 64) cache.delete(cache.keys().next().value!);
  const entry: CacheEntry = { promise: operation, expires: Infinity };
  cache.set(key, entry);
  void operation.then((result) => {
    if (cache.get(key) === entry) entry.expires = result.success ? Date.now() + CACHE_TTL_MS : Date.now();
  }, () => { if (cache.get(key) === entry) cache.delete(key); });
  return operation;
}

/** PR navigation needs only PR identity, never default-branch, CI or review queries. */
export async function getProviderPrLink(remoteUrl: string, branch?: string, options: ContextOptions = {}): Promise<string | null> {
  if (!branch) return null;
  const context = buildProviderContext('origin', remoteUrl, '');
  const provider = context && getProviderInstance(context.provider, context.baseUrl);
  if (!context || !provider) return null;
  context.headSha = options.identity?.headSha ?? options.headSha;
  const credential = getProviderPat(context.provider, context.baseUrl);
  const stored = hasStoredProviderPat(context.provider, context.baseUrl);
  if (stored && !credential.success) return null;
  const key = createHash('sha256').update(JSON.stringify([options.identity, options.identity?.remoteName ?? 'origin', remoteUrl,
    branch, context.headSha, '', getCredentialRevision(), instancePolicyRevision(), credential.token ?? '', stored])).digest('hex');
  const cached = options.identity && !options.refresh ? cache.get(key) : undefined;
  if (cached && Number.isFinite(cached.expires) && cached.expires > Date.now()) {
    const result = await cached.promise;
    return result.pullRequest?.exists ? result.pullRequest.url ?? null : null;
  }
  return withVcsBudget(async () => {
    try {
      const pr = await provider.getPullRequestForBranch(context, branch, credential.token);
      return pr.exists ? pr.url ?? null : null;
    } catch { return null; }
  }, options);
}
