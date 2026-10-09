import type { DeepLink, ProviderContext } from './types';
import { parseTrustedRemote } from './trustedRemote';

/** GitHub compare routing treats ref slashes as path separators, not encoded bytes. */
function encodeRefPath(ref: string): string {
  return ref.split('/').map(encodeURIComponent).join('/');
}

/** The single static, hosted-provider navigation contract. No API calls. */
export function providerLinks(context: ProviderContext, branch?: string, number?: number): DeepLink[] {
  const trusted = parseTrustedRemote(`${context.baseUrl}/${context.owner}/${context.repo}`);
  if (!trusted || trusted.provider !== context.provider || trusted.baseUrl !== context.baseUrl
    || trusted.owner !== context.owner || trusted.repo !== context.repo) return [];
  const root = `${trusted.baseUrl}/${trusted.owner}/${trusted.repo}`;
  const links: DeepLink[] = [];
  const add = (type: DeepLink['type'], suffix: string, label: string) => {
    links.push({ type, url: `${root}${suffix}`, label });
  };
  const validNumber = number !== undefined && Number.isSafeInteger(number) && number > 0;
  const source = branch ? encodeURIComponent(branch) : undefined;
  // When no target is known, let the provider's native page select its default.
  const target = context.defaultBranch ? encodeURIComponent(context.defaultBranch) : undefined;

  switch (trusted.provider) {
    case 'github':
      if (validNumber) add('pr', `/pull/${number}`, `PR #${number}`);
      add('repo', '', 'Repository');
      add('branches', '/branches', 'Branches');
      add('issues', '/issues', 'Issues');
      add('releases', '/releases', 'Releases');
      add('actions', '/actions', 'Actions');
      if (branch) {
        const head = encodeRefPath(branch);
        const base = context.defaultBranch ? `${encodeRefPath(context.defaultBranch)}...` : '';
        add('create-pr', `/compare/${base}${head}`, 'Create Pull Request');
      }
      break;
    case 'gitlab':
      if (validNumber) add('pr', `/-/merge_requests/${number}`, `MR !${number}`);
      add('repo', '', 'Repository');
      add('branches', '/-/branches', 'Branches');
      add('issues', '/-/issues', 'Issues');
      add('releases', '/-/releases', 'Releases');
      add('actions', '/-/pipelines', 'Pipelines');
      if (source) add('create-pr', `/-/merge_requests/new?merge_request[source_branch]=${source}${target ? `&merge_request[target_branch]=${target}` : ''}`, 'Create Merge Request');
      break;
    case 'bitbucket':
      if (validNumber) add('pr', `/pull-requests/${number}`, `PR #${number}`);
      add('repo', '', 'Repository');
      add('branches', '/branches', 'Branches');
      add('actions', '/pipelines', 'Pipelines');
      // Cloud has no native issue tracker or releases page. Downloads are not releases.
      // Undocumented branch-prefill query parameters are deliberately not guessed.
      if (source) add('create-pr', '/pull-requests/new', 'Create Pull Request');
      break;
  }
  return links;
}
