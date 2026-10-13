import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GitOverview } from '../../../../src/renderer/components/git/GitOverview';
import type { GitRepoMenuProps } from '../../../../src/renderer/components/git/GitRepoMenu';
import { useGitMenuResources } from '../../../../src/renderer/components/git/useGitMenuResources';
import type { ProviderContextResult } from '../../../../src/shared/types/vcs';
import { installElectronApiMock } from '../../../setup/electron';

const scope = { path: '/repo', workspaceId: 'ws', environmentId: 'local', checkoutLabel: 'Main', key: 'ws', blocked: null };
const isCurrent = () => true;
let api: ReturnType<typeof installElectronApiMock>;
const confirmed: ProviderContextResult = {
  success: true, provider: { provider: 'github', owner: 'a', repo: 'b', baseUrl: 'https://github.com', defaultBranch: 'main' },
  pullRequest: { exists: false, outcome: 'none' }, ci: { state: 'none' }, review: { state: 'none' },
};
function Harness() {
  const resources = useGitMenuResources(scope, '/repo', 'ws', isCurrent);
  const data = resources.provider.data;
  // Only provider presentation is under test; unrelated Overview actions are inert.
  const props = { scope, resources, statusKnown: true, remotes: [], currentBranchLabel: 'main',
    provider: 'unknown', providerContext: data?.provider ?? null, pullRequest: data?.pullRequest ?? null,
    ci: data?.ci, review: data?.review, vcsContextError: resources.provider.error,
    isLoadingContext: resources.provider.phase === 'loading', onRefresh: () => void resources.readProvider(true),
    onReviewChanges: vi.fn(),
  } as unknown as GitRepoMenuProps & { onReviewChanges: () => void };
  return <><button onClick={resources.provider.invalidate}>Invalidate provider</button>
    <button onClick={() => void resources.readProvider(true)}>Read provider</button>
    <GitOverview {...props} /></>;
}
function field(name: string) {
  return screen.getByText(name, { selector: 'dt' }).nextElementSibling!;
}
beforeEach(() => { api = installElectronApiMock({ vcsGetContext: vi.fn().mockResolvedValue(confirmed) }); });

describe('Overview provider acquisition freshness', () => {
  it.each([false, true])('never confirms retained absence after invalidation/loading/failure (partial=%s)', async partial => {
    const result = partial ? { ...confirmed, success: false, error: 'Review unavailable', review: { state: 'unknown' as const, problem: { code: 'forbidden' as const, message: 'Review unavailable' } } } : confirmed;
    api.vcsGetContext.mockResolvedValue(result);
    render(<Harness />);
    expect(field('Pull request')).toHaveTextContent('Unknown / unavailable');
    fireEvent.click(screen.getByText('Read provider'));
    await waitFor(() => expect(field('Pull request')).toHaveTextContent('No pull request (confirmed)'));
    expect(field('CI (checkout HEAD)')).toHaveTextContent('No checks (confirmed)');
    if (partial) expect(screen.getByText(/independently confirmed fields remain current/)).toBeVisible();
    fireEvent.click(screen.getByText('Invalidate provider'));
    for (const name of ['Provider repository', 'Pull request', 'CI (checkout HEAD)', 'Review']) {
      expect(field(name)).toHaveTextContent('Last known / unverified');
      expect(field(name)).not.toHaveTextContent('(confirmed)');
    }
    expect(screen.getByText(/Last known \/ partial information \(not current\)/)).toBeVisible();
    let reject!: (error: Error) => void;
    api.vcsGetContext.mockImplementationOnce(() => new Promise((_resolve, rejectRead) => { reject = rejectRead; }));
    fireEvent.click(screen.getByText('Read provider'));
    expect(field('Pull request')).toHaveTextContent('Loading provider context… · Last known / unverified');
    expect(field('CI (checkout HEAD)')).toHaveTextContent('Loading CI… · Last known / unverified');
    reject(new Error('Network unavailable'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Network unavailable'));
    for (const name of ['Provider repository', 'Pull request', 'CI (checkout HEAD)', 'Review']) {
      expect(field(name)).toHaveTextContent('Last known / unverified');
      expect(field(name)).not.toHaveTextContent('(confirmed)');
    }
    expect(screen.queryByRole('button', { name: 'View pull request' })).toBeNull();
    api.vcsGetContext.mockResolvedValue(confirmed);
    fireEvent.click(screen.getByText('Retry provider'));
    await waitFor(() => expect(field('CI (checkout HEAD)')).toHaveTextContent('No checks (confirmed)'));
    expect(field('Pull request')).toHaveTextContent('No pull request (confirmed)');
    expect(screen.queryByText(/not current/)).toBeNull();
  });

  it('keeps freshly confirmed partial PR links, but hides historical links after failed refresh', async () => {
    api.vcsGetContext.mockResolvedValue({ ...confirmed, success: false, error: 'CI unavailable',
      pullRequest: { exists: true, outcome: 'found', number: 12, state: 'open', url: 'https://github.com/a/b/pull/12' },
      ci: { state: 'unknown', problem: { code: 'forbidden', message: 'CI unavailable' } }, review: { state: 'approved' },
    });
    render(<Harness />);
    fireEvent.click(screen.getByText('Read provider'));
    await waitFor(() => expect(field('Pull request')).toHaveTextContent('#12 · open'));
    expect(field('Review')).toHaveTextContent('approved');
    expect(screen.getByText(/independently confirmed fields remain current/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'View pull request' }));
    expect(api.openExternal).toHaveBeenCalledWith('https://github.com/a/b/pull/12');
    fireEvent.click(screen.getByText('Invalidate provider'));
    expect(field('Pull request')).toHaveTextContent('Last known / unverified: #12 · open');
    expect(screen.queryByRole('button', { name: 'View pull request' })).toBeNull();
    api.vcsGetContext.mockRejectedValue(new Error('Network unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(field('Review')).toHaveTextContent('Loading reviews… · Last known / unverified: approved');
    expect(screen.queryByRole('button', { name: 'View pull request' })).toBeNull();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Network unavailable'));
    expect(field('Pull request')).toHaveTextContent('Last known / unverified: #12 · open');
    expect(field('Review')).toHaveTextContent('Last known / unverified: approved');
    expect(screen.queryByRole('button', { name: 'View pull request' })).toBeNull();
  });
});
