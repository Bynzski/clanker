# VCS Provider Integration

Technical documentation for remote VCS provider integration.

## Overview

Clanker Grid integrates with GitHub, GitLab, and Bitbucket to provide contextual information about your repository without leaving the app.

## Architecture

```
src/
├── shared/types/vcs.ts     # Shared type definitions
├── main/vcs/
│   ├── providerDetector.ts  # Detect provider from remote URL
│   ├── providerRegistry.ts # Provider instance management
│   ├── contextService.ts   # Orchestrates API calls
│   └── providers/
│       ├── baseProvider.ts      # Abstract interface
│       ├── githubProvider.ts    # GitHub REST API
│       ├── gitlabProvider.ts    # GitLab REST API
│       └── bitbucketProvider.ts # Bitbucket API
└── main/credential/
    ├── credentialService.ts  # PAT storage
    └── sshKeyService.ts      # SSH key management
```

## Provider Detection

Providers are detected automatically from git remote URLs:

| Format | Provider |
|--------|---------|
| `git@github.com:owner/repo.git` | GitHub |
| `https://github.com/owner/repo.git` | GitHub |
| `git@gitlab.com:owner/repo.git` | GitLab |
| `https://gitlab.example.com/owner/repo.git` | GitLab (self-hosted) |
| `git@bitbucket.org:owner/repo.git` | Bitbucket |
| `https://bitbucket.org/owner/repo.git` | Bitbucket |

### Implementation

```typescript
// src/main/vcs/providerDetector.ts
import { detectProvider, buildProviderContext } from './providerDetector';

// Detect provider from URL
const provider = detectProvider('git@github.com:owner/repo.git');
// Returns: 'github'

// Build full context
const context = buildProviderContext('origin', remoteUrl, 'main');
// Returns: { provider: 'github', baseUrl: 'https://github.com', owner: '...', repo: '...', defaultBranch: 'main' }
```

## API Features

### Pull Request Detection

Each provider looks up the current branch's PR/MR:

| Provider | API Endpoint | Filter |
|----------|--------------|--------|
| GitHub | `/repos/{owner}/{repo}/pulls` | `head={owner}:{branch}` |
| GitLab | `/projects/{id}/merge_requests` | `source_branch={branch}` |
| Bitbucket | `/repositories/{workspace}/{repo}/pullrequests` | `source.branch.name={branch}` |

### CI/CD Status

| Provider | API Endpoint | Data |
|----------|--------------|------|
| GitHub | `/repos/{owner}/{repo}/commits/{sha}/status` | Combined status |
| GitLab | `/projects/{id}/pipelines` | Latest pipeline |
| Bitbucket | `/repositories/{workspace}/{repo}/pullrequests/{id}` | Pipeline status |

### Review State

| Provider | API Endpoint | Status |
|----------|--------------|--------|
| GitHub | `/repos/{owner}/{repo}/pulls/{pr}/reviews` | approved, changes_requested, commented |
| GitLab | `/projects/{id}/merge_requests/{mr}/approvals` | approvals_left === 0 |
| Bitbucket | `/repositories/{workspace}/{repo}/pullrequests/{id}/participants` | approved field |

### Default Branch Resolution

Providers fetch the repository's actual default branch (e.g., `main`, `master`):

```typescript
// Via IVcsProvider interface
interface IVcsProvider {
  getDefaultBranch(context: ProviderContext, token?: string): Promise<string>;
}
```

## IPC Channels

### Git Remote Management

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `git:get-remotes` | renderer → main | List all remotes |
| `git:add-remote` | renderer → main | Add a new remote |
| `git:remove-remote` | renderer → main | Remove an existing remote |
| `git:rename-remote` | renderer → main | Rename an existing remote |

### Example: Add Remote

```typescript
// Renderer
const result = await window.electronAPI.gitAddRemote(
  workspacePath,
  'origin',
  'git@github.com:owner/repo.git'
);
// Returns: { success: true }
```

### VCS Provider Context

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `vcs:get-context` | renderer → main | Get provider context, PR info, and deep links |
| `vcs:get-pr-info` | renderer → main | Get PR info for current branch |
| `vcs:get-deep-links` | renderer → main | Get quick navigation links |
| `vcs:open-deep-link` | renderer → main | Open link in system browser |

### Example: Get Provider Context

```typescript
// Renderer
const result = await window.electronAPI.vcsGetContext(workspacePath);
// Returns:
// {
//   success: true,
//   provider: { provider: 'github', owner: '...', repo: '...', defaultBranch: 'main' },
//   pullRequest: { exists: true, number: 123, title: '...', state: 'open', checksStatus: 'success' },
//   deepLinks: [{ type: 'repo', url: '...', label: 'Repository' }, ...]
// }
```

## Credential Management

### SSH Keys

ED25519 keys are generated client-side:

```typescript
// src/main/credential/sshKeyService.ts
import { generateSshKey, readPublicKey, sshKeyExists } from './sshKeyService';

const result = await generateSshKey();
// { success: true, publicKey: 'ssh-ed25519 AAAA...', fingerprint: 'SHA256:...' }

const exists = sshKeyExists();
// Returns: true if ~/.ssh/id_ed25519_clanker exists
```

### Personal Access Tokens

Tokens are stored encrypted using Electron's `safeStorage`:

```typescript
// src/main/credential/credentialService.ts
import { savePat, getPat, deletePat } from './credentialService';

// Save token
await savePat({ provider: 'github', token: 'ghp_xxx', scope: ['repo'] });

// Retrieve token
const result = getPat('github');
// { success: true, token: 'ghp_xxx' }

// Delete token
await deletePat('github');
```

### SSH Host Configuration

Automatically configure SSH to use the generated key:

```typescript
import { configureSshForHost } from './credentialService';

await configureSshForHost('github.com');
// Appends to ~/.ssh/config:
// Host github.com
//   IdentityFile ~/.ssh/id_ed25519_clanker
//   IdentitiesOnly yes
```

## Deep Links

Provider-specific URLs for quick navigation:

### GitHub

| Type | URL Pattern |
|------|-------------|
| repo | `/{owner}/{repo}` |
| pr | `/{owner}/{repo}/pull/{number}` |
| create-pr | `/{owner}/{repo}/compare/{base}...{head}` |
| branches | `/{owner}/{repo}/branches` |
| issues | `/{owner}/{repo}/issues` |
| releases | `/{owner}/{repo}/releases` |
| actions | `/{owner}/{repo}/actions` |

### GitLab

| Type | URL Pattern |
|------|-------------|
| repo | `/{owner}/{repo}` |
| mr | `/{owner}/{repo}/-/merge_requests/{number}` |
| create-mr | `/{owner}/{repo}/-/merge_requests/new?merge_request[source_branch]={branch}` |
| branches | `/{owner}/{repo}/-/branches` |
| issues | `/{owner}/{repo}/-/issues` |
| releases | `/{owner}/{repo}/-/releases` |
| pipelines | `/{owner}/{repo}/-/pipelines` |

### Bitbucket

| Type | URL Pattern |
|------|-------------|
| repo | `/{workspace}/{repo}` |
| pr | `/{workspace}/{repo}/pull-requests/{id}` |
| create-pr | `/{workspace}/{repo}/pull-requests/new?source_branch={branch}` |
| branches | `/{workspace}/{repo}/branches` |
| issues | `/{workspace}/{repo}/issues` |
| downloads | `/{workspace}/{repo}/downloads` |
| pipelines | `/{workspace}/{repo}/pipelines` |

## Testing

Provider implementations are tested with mocked API responses:

```bash
# Run all VCS tests
npm test -- tests/main/unit/vcs/

# Run specific provider tests
npm test -- tests/main/unit/vcs/githubProvider.test.ts
npm test -- tests/main/unit/vcs/gitlabProvider.test.ts
npm test -- tests/main/unit/vcs/bitbucketProvider.test.ts
npm test -- tests/main/unit/vcs/providerDetector.test.ts
```

## Security Considerations

1. **Token Storage** — PATs encrypted with `safeStorage` API
2. **SSH Keys** — Private keys stored with 600 permissions
3. **API Calls** — HTTPS only, no credential logging
4. **Minimal Scopes** — Request only `repo` scope by default
