/**
 * Provider Detector Tests
 * Tests for detecting VCS providers from git remote URLs.
 */

import { describe, it, expect } from 'vitest';
import {
  detectProvider,
  parseRemoteUrl,
  getApiBaseUrl,
  getWebBaseUrl,
  buildProviderContext,
  buildDeepLink,
  getProviderDeepLinks,
  getDeepLinkUrl,
} from '../../../../src/main/vcs/providerDetector';

describe('detectProvider', () => {
  it('should detect GitHub from SSH URL', () => {
    expect(detectProvider('git@github.com:owner/repo.git')).toBe('github');
    expect(detectProvider('git@github.com:microsoft/vscode.git')).toBe('github');
  });

  it('should detect GitHub from HTTPS URL', () => {
    expect(detectProvider('https://github.com/owner/repo.git')).toBe('github');
    expect(detectProvider('https://github.com/microsoft/vscode')).toBe('github');
  });

  it('should detect GitLab from SSH URL', () => {
    expect(detectProvider('git@gitlab.com:owner/repo.git')).toBe('gitlab');
    expect(detectProvider('git@gitlab.com:gitlab-org/gitlab.git')).toBe('gitlab');
  });

  it('should detect GitLab from HTTPS URL', () => {
    expect(detectProvider('https://gitlab.com/owner/repo.git')).toBe('gitlab');
    expect(detectProvider('https://gitlab.com/gitlab-org/gitlab')).toBe('gitlab');
  });

  it('should detect self-hosted GitLab', () => {
    expect(detectProvider('git@gitlab.example.com:owner/repo.git')).toBe('gitlab');
    expect(detectProvider('https://gitlab.example.com/owner/repo.git')).toBe('gitlab');
  });

  it('should detect Bitbucket from SSH URL', () => {
    expect(detectProvider('git@bitbucket.org:owner/repo.git')).toBe('bitbucket');
    expect(detectProvider('git@bitbucket.org:atlassian/jira-software.git')).toBe('bitbucket');
  });

  it('should detect Bitbucket from HTTPS URL', () => {
    expect(detectProvider('https://bitbucket.org/owner/repo.git')).toBe('bitbucket');
    expect(detectProvider('https://bitbucket.org/atlassian/jira-software')).toBe('bitbucket');
  });

  it('should return unknown for unrecognized hosts', () => {
    expect(detectProvider('git@custom-git.example.com:owner/repo.git')).toBe('unknown');
    expect(detectProvider('https://custom-git.example.com/owner/repo.git')).toBe('unknown');
  });

  it('should return unknown for empty or invalid URLs', () => {
    expect(detectProvider('')).toBe('unknown');
    expect(detectProvider('not-a-url')).toBe('unknown');
  });
});

describe('parseRemoteUrl', () => {
  it('should parse SSH URLs', () => {
    expect(parseRemoteUrl('git@github.com:owner/repo.git')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
    expect(parseRemoteUrl('git@github.com:microsoft/vscode')).toEqual({
      owner: 'microsoft',
      repo: 'vscode',
    });
  });

  it('should parse HTTPS URLs', () => {
    expect(parseRemoteUrl('https://github.com/owner/repo.git')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
    expect(parseRemoteUrl('https://gitlab.com/microsoft/vscode')).toEqual({
      owner: 'microsoft',
      repo: 'vscode',
    });
  });

  it('should handle URLs without .git extension', () => {
    expect(parseRemoteUrl('https://github.com/owner/repo')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('should return null for invalid URLs', () => {
    expect(parseRemoteUrl('')).toBeNull();
    expect(parseRemoteUrl('invalid')).toBeNull();
  });
});

describe('getApiBaseUrl', () => {
  it('should return correct API URL for GitHub', () => {
    expect(getApiBaseUrl('github')).toBe('https://api.github.com');
  });

  it('should return correct API URL for GitLab', () => {
    expect(getApiBaseUrl('gitlab')).toBe('https://gitlab.com/api/v4');
    expect(getApiBaseUrl('gitlab', 'https://gitlab.example.com/owner/repo.git')).toContain('gitlab.example.com/api/v4');
  });

  it('should return correct API URL for Bitbucket', () => {
    expect(getApiBaseUrl('bitbucket')).toBe('https://api.bitbucket.org/2.0');
  });

  it('should return empty string for unknown provider', () => {
    expect(getApiBaseUrl('unknown')).toBe('');
  });
});

describe('getWebBaseUrl', () => {
  it('should return correct web URL for GitHub', () => {
    expect(getWebBaseUrl('github')).toBe('https://github.com');
  });

  it('should return correct web URL for GitLab', () => {
    expect(getWebBaseUrl('gitlab')).toBe('https://gitlab.com');
    expect(getWebBaseUrl('gitlab', 'https://gitlab.example.com/owner/repo.git')).toContain('gitlab.example.com');
  });

  it('should return correct web URL for Bitbucket', () => {
    expect(getWebBaseUrl('bitbucket')).toBe('https://bitbucket.org');
  });

  it('should return empty string for unknown provider', () => {
    expect(getWebBaseUrl('unknown')).toBe('');
  });
});

describe('buildProviderContext', () => {
  it('should build context for GitHub SSH URL', () => {
    const context = buildProviderContext('origin', 'git@github.com:owner/repo.git', 'main');
    expect(context).toEqual({
      provider: 'github',
      baseUrl: 'https://github.com',
      owner: 'owner',
      repo: 'repo',
      defaultBranch: 'main',
    });
  });

  it('should build context for GitLab HTTPS URL', () => {
    const context = buildProviderContext('origin', 'https://gitlab.com/owner/repo.git', 'main');
    expect(context).toEqual({
      provider: 'gitlab',
      baseUrl: 'https://gitlab.com',
      owner: 'owner',
      repo: 'repo',
      defaultBranch: 'main',
    });
  });

  it('should return null for unknown provider', () => {
    expect(buildProviderContext('origin', 'git@custom.example.com:owner/repo.git', 'main')).toBeNull();
  });
});

describe('buildDeepLink', () => {
  it('should build repo deep link', () => {
    const url = buildDeepLink('github', 'https://github.com', 'owner', 'repo', 'repo');
    expect(url).toBe('https://github.com/owner/repo');
  });

  it('should build PR deep link', () => {
    const url = buildDeepLink('github', 'https://github.com', 'owner', 'repo', 'pr', undefined, 123);
    expect(url).toBe('https://github.com/owner/repo/pull/123');
  });

  it('should build create PR deep link', () => {
    const url = buildDeepLink('github', 'https://github.com', 'owner', 'repo', 'create-pr', 'feature-branch');
    expect(url).toBe('https://github.com/owner/repo/compare/main...feature-branch');
  });

  it('should build issues deep link', () => {
    const url = buildDeepLink('gitlab', 'https://gitlab.com', 'owner', 'repo', 'issues');
    expect(url).toBe('https://gitlab.com/owner/repo/issues');
  });

  it('should build branches deep link for GitLab', () => {
    // Note: The generic buildDeepLink uses /branches
    // Provider-specific implementations (GitLabProvider.getDeepLinks) use /-/branches
    const url = buildDeepLink('gitlab', 'https://gitlab.com', 'owner', 'repo', 'branches');
    expect(url).toBe('https://gitlab.com/owner/repo/branches');
  });
});

describe('getProviderDeepLinks', () => {
  it('should return deep links for GitHub', () => {
    const links = getProviderDeepLinks('git@github.com:owner/repo.git', 'feature-branch');
    expect(links.length).toBeGreaterThan(0);
    expect(links.map((l) => l.type)).toContain('repo');
    expect(links.map((l) => l.type)).toContain('create-pr');
  });

  it('should return deep links with PR number', () => {
    const links = getProviderDeepLinks('git@github.com:owner/repo.git', 'feature-branch', 123);
    const prLink = links.find((l) => l.type === 'pr');
    expect(prLink).toBeDefined();
    expect(prLink?.url).toContain('/pull/123');
  });

  it('should return empty array for unknown provider', () => {
    const links = getProviderDeepLinks('git@custom.example.com:owner/repo.git');
    expect(links).toEqual([]);
  });

  it('should return empty array for empty URL', () => {
    const links = getProviderDeepLinks('');
    expect(links).toEqual([]);
  });
});

describe('getDeepLinkUrl', () => {
  it('should return deep link URL for specific type', () => {
    const url = getDeepLinkUrl('git@github.com:owner/repo.git', 'repo');
    expect(url).toBe('https://github.com/owner/repo');
  });

  it('should return null for invalid URL', () => {
    const url = getDeepLinkUrl('invalid', 'repo');
    expect(url).toBeNull();
  });
});
