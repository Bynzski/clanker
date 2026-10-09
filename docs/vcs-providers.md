# VCS Provider Integration

Clanker Grid recognizes GitHub, GitLab, and Bitbucket remotes and shows provider context in the Git menu. Git operations use the local Git CLI for local workspaces and Git over SSH on the workspace host for SSH workspaces. Provider API calls from the desktop supply pull request or merge request details, checks, reviews, and links.

## Detection and context

`src/main/vcs/providerDetector.ts` accepts unambiguous HTTPS and SSH repository remotes for exactly `github.com`, `gitlab.com`, and `bitbucket.org`, including full GitLab namespaces. HTTP, custom ports, URL credentials, and unknown hosts have no provider context. Self-managed GitLab API context is disabled until explicit instance approval and separate host-bound tokens are implemented; a hostname containing `gitlab` is not trusted. This does not affect Git operations on those remotes. A detected provider does not imply successful API access.

`src/main/vcs/contextService.ts` combines the remote, current branch, an optional stored access token, and provider API results. Each implementation in `src/main/vcs/providers/` resolves the repository's default branch, looks for a pull request or merge request on the current branch, and fetches checks and review state when one exists. API results can be unavailable because of network errors, permissions, or provider configuration.

The **View on provider** menu offers links such as repository, request, branches, issues, and releases when the provider supplies them. Links open in the system browser after URL validation.

## Authentication

The **Settings → Credentials** panel can generate a Clanker ED25519 key, configure SSH hosts, and store access tokens for the three providers. New tokens are encrypted with Electron `safeStorage`; saving and reading fail closed when encryption is unavailable. Decryption failures require unlocking the OS credential store or saving the token again; existing encrypted tokens are preserved. Stored tokens are never returned to the renderer. Provider requests are HTTPS, constrained to the provider's fixed API origin, bounded by timeout/retries, and do not follow redirects. Git fetch, pull, and push continue to use Git's own SSH or credential helper configuration. See [Configuration](configuration.md) and [Git Integration](git-integration.md).

In an SSH workspace, Git and its credentials run on the workspace host. Provider API requests and stored access tokens remain on the desktop; Clanker does not copy a desktop SSH key or token onto the host.

## Implementation map

| Area | Source |
|------|--------|
| Remote parsing and link construction | `src/main/vcs/providerDetector.ts` |
| Provider selection | `src/main/vcs/providerRegistry.ts` |
| API orchestration | `src/main/vcs/contextService.ts` |
| GitHub, GitLab, Bitbucket APIs | `src/main/vcs/providers/` |
| Token and SSH key management | `src/main/credential/` |
| Renderer provider state and menu | `src/renderer/store/vcsStore.ts`, `src/renderer/components/git/` |
| IPC contracts | `src/shared/ipcChannels.ts`, `src/main/ipc/vcsIpc.ts`, `src/main/ipc/credentialIpc.ts` |

The renderer calls the preload bridge. Do not import main-process provider or credential modules into renderer code. Test the provider implementations with `npm run test -- tests/main/unit/vcs/`.
