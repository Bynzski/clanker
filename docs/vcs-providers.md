# VCS Provider Integration

Provider context is read-only desktop API metadata. Git operations remain local Git or Git through the registered SSH environment; desktop tokens and keys are never copied to SSH hosts. This backend phase does **not** add provider dashboards, menus, status presentation or instance-enrollment UI.

## Identity and truthful results

`VCS_GET_CONTEXT` / `VCS_GET_PR_INFO` accept an optional registered `checkoutContextId`, not an arbitrary working directory. Main resolves workspace → environment → checkout root, reads actual Git HEAD and branch through the existing scoped executor, and selects the branch's upstream remote. Without upstream, it uses `origin`, then a sole remote; ambiguous/missing remotes are unavailable. Detached HEAD is explicit (`branch: null`); unborn HEAD is unavailable. Neither is guessed as `main`.

Main returns `identity` (workspace, environment, context, canonical root, remote, branch and SHA), rechecking the exact registered objects and Git snapshot after async API work. Closed/replaced/released checkouts and changed HEAD/branch/remotes reject late results. Renderer selection uses a registered launch context, main-resolved agent location, or explicitly focused editor context—not parsed shell cwd text. Renderer request generations discard old responses after refresh, focus/workspace changes or unmount. Unassociated/missing contexts cannot silently fetch the main checkout's context.

The additive shared contract separates:

- PR discovery: `found`, confirmed `none`, or a typed problem. `exists: false` means **confirmed absence only**; unavailable discovery leaves `exists` unset.
- CI: `success`, `failure`, `pending`, `none` (no observed checks for this HEAD), `unknown`, plus an optional sanitized problem. Failure dominates known success/pending; missing sources, incomplete pagination and neutral/skipped-only data never imply success.
- Reviews: `approved`, `changes_requested`, `pending`, `none`, `unknown`, with availability independent of PR discovery and CI.
- Problems: authentication required, forbidden, rate-limited, network error, unsupported, cancelled, timeout, malformed/oversized response, incomplete pagination, inaccessible/not-found resource, stale identity and unknown failure.

Partial API failure preserves already discovered PR identity. Legacy projections cannot turn unavailable/empty data into green or approval; the existing badge no longer treats unknown discovery as “Create PR”. Full normalized snapshots are retained in `vcsStore.contextSnapshot` for future presentation. These summaries describe observed native state, **not merge eligibility**, complete branch-protection rules, or a guarantee that every workflow has run.

## Provider contracts

| Provider | Discovery | CI at checkout HEAD | Review source |
|---|---|---|---|
| GitHub | Paginated PRs matched by source/base repo, branch and SHA; open first, then highest PR number. Forks use API-derived parent repository. | Checks API (`filter=latest`) plus latest legacy status per context, including a discovered fork PR's target repository at the same SHA; failure/cancellation/timeout/action-required fail, queued/running pending, neutral/skipped not green. | Paginated latest submitted decision per reviewer; comments/drafts do not erase decisions, dismissal removes them. Native requested reviewers/teams keep the result pending. |
| GitLab | Full nested namespace, project IDs, branch and SHA; native fork parent namespace/ID routes target MRs. Open first, then highest IID. | Latest SHA/ref-filtered project pipeline plus relevant MR pipeline for the same SHA. Historical MR commits cannot override current HEAD. Manual/pending/running states are pending; cancellation fails. | Required approval rules from `approval_state`, plus native approvals when no required rules exist. Missing/forbidden approval APIs remain unknown, not “approved” or “none configured”. |
| Bitbucket Cloud | Native paginated PR envelope; source and destination repo, branch and SHA; API-derived fork parent. Open first, then highest ID. | `/commit/<actual SHA>/statuses`, not a branch name; failed/stopped fail, in-progress pending. | Native PR self resource's `participants` and `reviewers` (there is no `/participants` endpoint). Outstanding requested reviewers remain pending; changes requested dominates approval. |

Unpublished local HEAD, incomplete metadata and unsupported associations are explicit unavailable/stale outcomes. Fork lookup covers the native parent relationship, not an arbitrary unrelated PR destination or exhaustive fork-network search.

## Transport and cache

All API requests require HTTPS and the exact provider/approved-instance API origin, reject redirects and credentials in URLs, and use provider-specific auth headers. Error messages are stable application text; response bodies and exception text are never returned as diagnostics.

- One **10-second API context budget**, including sequential calls, body reads and retries; individual attempts last at most **4 seconds**. Cancellation stops subsequent attempts and retry waits.
- Metadata snapshots use the existing local/SSH Git executor with a **4-second aggregate budget per snapshot**. Initial and final snapshots bound the IPC lifecycle in addition to the API budget (approximately 18 seconds maximum, excluding scheduling delays).
- Streaming reads enforce **2 MiB/page** after decompression and **8 MiB total/request scope**. `Content-Length` is only an early check; missing/lying headers cannot bypass the streaming cap. Readers, timers and abort listeners are cleaned up.
- At most **8 pages × 100 rows** per collection. GitHub Link/total-count, GitLab next-page/total, and Bitbucket next/size signals are bounded and validated. Continuations must retain origin, endpoint and non-pagination filters; truncation is reported, not accepted as success.
- Only transient network/rate-limit failures retry, at most twice, with cancellable backoff and bounded remaining time. Auth, permission and missing-resource errors do not retry. Retry-After and GitHub primary/secondary rate-limit headers are respected when budget permits.
- Request-scoped memoization shares identical metadata reads. A **64-entry, five-second, on-demand cache** deduplicates equivalent full context/PR-info calls and lets completed context satisfy PR navigation. Keys bind environment, workspace, checkout/root, remote, branch, SHA, credential digest/revision and instance-policy revision. No plaintext token is stored in a key. Explicit Refresh bypasses cache; failures/auth-unavailable responses are not retained for reuse. There are **no cache timers or new background pollers**.

Static links never query APIs or credentials. Existing-PR navigation performs only necessary PR discovery when not already cached, never CI/review/default-branch queries. GitHub/GitLab creation links let the native page choose an unknown target branch; Bitbucket's form requires manual branch selection. GitLab uses `/-/` paths; retired Bitbucket issues and unsupported releases links remain omitted.

## Credentials and approved self-managed GitLab

Hosted GitHub, GitLab and Bitbucket identities remain exact known origins. A host merely containing “gitlab” is never trusted. Self-managed GitLab is enabled **only** by main-owned explicit approval of a canonical HTTPS origin, including its port. Approval is empty by default; ordinary Git still works on unapproved hosts.

Trusted main/bootstrap integrations may call `approveGitLabInstance(origin)`, `saveGitLabInstancePat(origin, token, scopes)` and `revokeGitLabInstance(origin)` in `credentialService.ts`. This phase ships no renderer enrollment IPC, settings workflow or CLI for them. Up to 16 approved origins persist in the main credential store and restore during credential IPC registration. Tokens are separately OS-encrypted under origin-digest keys. A SaaS `gitlab.com` PAT **never** falls back to a self-managed instance. Ports remain separate credential identities; SSH hostname remotes resolve only when exactly one approved origin has that hostname. Revocation is rechecked at dispatch, even on existing provider instances. It stops runtime dispatch immediately; a persistence failure is reported and must be retried before restart. Approval-store read failures restore an empty policy.

Saving and reading fail closed without OS-backed Electron `safeStorage` (including Linux `basic_text`) or on decryption failure; existing ciphertext is preserved. A stored but undecryptable credential does not silently trigger anonymous requests. Stored/decryptable status, an identity-only `/user` validation, and repository/CI/review access are different facts. The existing “validated” metadata is an identity check, not proof of adequate repository permissions; declared scope metadata is not inferred or verified by saving a token.

- **GitHub:** fine-grained tokens need the selected repository and read access to Metadata, Pull requests, Checks and Commit statuses; identity lookup may require its applicable user permissions. Classic tokens usually use `repo` for private repositories; use least privilege and provider approval/SSO requirements.
- **GitLab:** use `read_api` and membership/access to the relevant source/target projects. Approval availability depends on edition/version and permissions.
- **Bitbucket:** this transport supports **Bearer OAuth/access tokens**, including repository/project/workspace access tokens with appropriate repository/pull-request/pipeline read permissions. It does **not** implement email+API-token Basic auth or retired app passwords. A repository-scoped token can read its repository while `/user` identity validation is unavailable; that is not proof of failed repository access. See [repository access tokens](https://support.atlassian.com/bitbucket-cloud/docs/using-repository-access-tokens/).

SSH configuration rejects empty/wildcard/option/control-character/invalid hostnames before filesystem writes and quotes the identity path. PAT deletion/storage failures are sanitized. Renderer APIs never receive raw tokens.

## Verification and remaining manual checks

Run `npm run validate`; focused coverage includes real provider implementations (not copied test-provider algorithms), native fetch through a local HTTP contract server, authentic endpoint/envelope shapes, pagination, review supersession, CI aggregation, host credential isolation, cancellation/body limits, cache keys and stale local/SSH checkout results. The local HTTP router is test-only; production origin/redirect validation remains active.

A temporary real local Git fixture verified upstream selection, isolated-worktree HEAD and detached state, then was removed. No authenticated GitHub/GitLab/Bitbucket, live self-managed instance, real SSH or OS keyring-lock smoke is claimed. Before release, use dedicated public/private/limited-scope tokens and temporary repositories to check:

1. Normal, fork, nested-namespace and approved-instance context; insufficient permissions and revoked tokens.
2. Local and registered SSH checkouts at the same path; focus an isolated checkout and verify returned root/remote/SHA.
3. Switch branches/HEAD/remotes or close/release the checkout while a request is pending; old identity must not apply.
4. Native cancelled/manual/neutral CI and review supersession, requested reviewers, unavailable approval APIs, pagination and throttling.
5. Lock/unlock the real OS secret store; preserve ciphertext and show unavailable access without token disclosure or anonymous fallback.
6. Provider navigation, including slash/Unicode refs and Bitbucket manual branch selection.

New unavailable/rate-limit/none-state presentation, richer CI/review UI, dashboards and instance management UI remain deliberately deferred. Issue #145 stays open; no issue-status change is implied by this backend work. See [Configuration](configuration.md), [Git integration](git-integration.md), and the [historical phase-one checkpoint](issue-145-progress.md).
