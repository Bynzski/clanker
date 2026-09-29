# VCS Provider Integration

Clanker Grid recognizes GitHub, GitLab, and Bitbucket remotes and shows provider context in the Git menu. Git operations use the local Git CLI for local workspaces and Git over SSH on the workspace host for SSH workspaces. Provider API calls from the desktop supply pull request or merge request details, checks, reviews, and links.

## Detection and context

`src/main/vcs/providerDetector.ts` parses SSH and HTTP(S) remote URLs. It recognizes `github.com`, `gitlab.com`, and `bitbucket.org`; other hosts containing `gitlab` are treated as self-hosted GitLab. Unrecognized hosts have no provider context. A detected provider does not imply successful API access.

`src/main/vcs/contextService.ts` combines the remote, current branch, an optional stored access token, and provider API results. Each implementation in `src/main/vcs/providers/` resolves the repository's default branch, looks for a pull request or merge request on the current branch, and fetches checks and review state when one exists. API results can be unavailable because of network errors, permissions, or provider configuration.

The **View on provider** menu offers links such as repository, request, branches, issues, and releases when the provider supplies them. Links open in the system browser after URL validation.

## Authentication

The **Settings → Credentials** panel can generate a Clanker ED25519 key, configure SSH hosts, and store access tokens for the three providers. New tokens are encrypted with Electron `safeStorage`; saving fails when OS-backed encryption is unavailable. Git fetch, pull, and push continue to use Git's own SSH or credential helper configuration. See [Configuration](configuration.md) and [Git Integration](git-integration.md).

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
