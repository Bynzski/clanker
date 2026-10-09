# Issue #145: credential-boundary hardening and corrective review

This branch implements the security-first slice of [#145](https://github.com/Bynzski/clanker/issues/145), not the entire issue. No Git/Settings navigation redesign or Git credential-system changes are included. Do not close #145 based on this patch.

## Implemented security boundary

- Provider detection requires exact hosted origins and unambiguous HTTPS/SSH repository URLs. Spoofed GitLab hosts cannot trigger token lookup or API dispatch. GitLab nested namespaces are preserved.
- Self-managed GitLab API context is **disabled**, rather than implicitly authorized by a hostname substring or given the global GitLab token. Explicit instance approval, separate instance-bound tokens, and host-correct enterprise links remain future work. Local/SSH Git fetch, pull, and push on these hosts still use Git's own credentials and work normally.
- Token retrieval fails closed if secure storage is unavailable or decryption fails. Linux `basic_text` is rejected for saving and reading. Stored ciphertext is preserved. Encryption/decryption error details are not serialized to renderer callers.
- Stored-token retrieval is removed from preload and renderer declarations. The legacy IPC channel denies retrieval, including direct renderer callers. Main-process provider requests retain access.
- All three providers use shared transport constrained to their fixed HTTPS API origins, without URL credentials or redirects. Authentication HTTP failures are not retried. Provider/network exception messages are sanitized rather than exposing arbitrary URLs or token-bearing errors.
- Credential UI no longer claims saved tokens authenticate Git commands or that the generated SSH private key is encrypted.

## Corrective review: navigation

`providerLinks.ts` is the single provider-specific link implementation, used by detector helpers and provider implementations. It independently validates directly constructed contexts against the same trusted remote boundary. No unsupported host gains links or API access.

Paths below are relative to the validated repository URL (`/<full namespace>/<repository>`):

| Type | GitHub | GitLab | Bitbucket Cloud |
|------|--------|--------|-----------------|
| Repository | repository root | repository root | repository root |
| Existing request | `/pull/{number}` | `/-/merge_requests/{number}` | `/pull-requests/{number}` |
| Create request | `/compare/{target}...{source}` | `/-/merge_requests/new` with `merge_request[source_branch]` and known target | `/pull-requests/new` |
| Branches | `/branches` | `/-/branches` | `/branches` |
| Issues | `/issues` | `/-/issues` | omitted (retired) |
| Releases | `/releases` | `/-/releases` | omitted (Downloads are not releases) |
| CI navigation | `/actions` | `/-/pipelines` | `/pipelines` |

Branch values are URI-encoded, including slashes, Unicode and query delimiters. Nested GitLab namespace separators remain intact. Request links require a positive safe integer. No request or creation identity is invented when it is absent.

Static navigation IPC requests no longer fetch complete provider context. When the target branch is unknown, GitHub's single-ref compare URL and GitLab's source-only form let the provider choose its native default; they do not guess `main` or call an API. Bitbucket opens its native form for manual branch selection rather than guessing undocumented prefill parameters. Only a single-request PR-link lookup discovers necessary PR identity, with the same bounded request scope; it never fetches checks, reviews or the default branch, and constructs a trusted URL instead of opening an API-supplied URL. Detached navigation does not invent a branch.

Contract audit references retrieved during this corrective pass:

- GitHub [comparing commits](https://docs.github.com/en/pull-requests/committing-changes-to-your-project/viewing-and-comparing-commits/comparing-commits) and [creating a pull request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-a-pull-request).
- GitLab [creating merge requests](https://docs.gitlab.com/user/project/merge_requests/creating_merge_requests/) and its public project routes/controller source (GitLab's `gitlabhq/gitlabhq` mirror). Project navigation uses the `/-/` route namespace.
- Bitbucket [creating a pull request](https://support.atlassian.com/bitbucket-cloud/docs/create-a-pull-request/) and [changelog](https://developer.atlassian.com/cloud/bitbucket/changelog/) (CHANGE-3401 confirms native issue-tracker removal). A native create-PR route was checked unauthenticated; private/nonexistent repositories return 404, so this is not an authenticated browser smoke.

## Corrective review: request lifetime

- One **10-second total budget** covers the complete provider context lifecycle, including sequential calls, hidden historical-request lookups, body reads and retry backoff. Individual attempts have a **4-second limit**, clipped to the remaining budget.
- Main-only `AsyncLocalStorage` carries the shared budget through existing provider interfaces and nested helper calls; concurrent requests using singleton providers cannot overwrite each other's cancellation state. No request state crosses IPC or is added to shared renderer contracts.
- Caller cancellation is available on `getProviderContext` through optional main-only request options. Attempts and retry waits observe the scope's abort signal. An individual timeout cancels the context, with no retry or subsequent endpoint dispatch. Network failures allow at most two retries when time remains; HTTP failures are not retried.
- The attempt timer remains active through response-body consumption, rather than ending when headers arrive. Listeners and timers are removed on success, failure and cancellation. Context cancellation/deadline exhaustion returns failure with safe static navigation links and no fabricated PR result.
- No new polling or caching subsystem was introduced. Rate-limit-aware retry and typed partial-provider outcomes remain separate #145 work.

## Integration and verification

Corrective work started at `175c8c52146a96e11a6db20cca8764e4230dc1c0`. Current main (`9da6698b127a9969beef2e7b0d401e29fe10e246`) was merged without conflicts. The diff against main preserves its unrelated preload APIs, renderer declarations, shared contracts, workspace pages and dev-service changes; only stored-token retrieval remains intentionally removed.

Focused tests cover every supported provider link type through all entry points, omitted destinations, unknown targets, nested namespaces, malicious remotes and directly constructed contexts; static IPC navigation without context refetch; PR-only discovery; delayed network calls, retries, exhausted budgets, caller cancellation, body stalls, concurrent request isolation, HTTP authentication failures, secret-bearing errors, insecure/unavailable storage, and renderer token denial. Relevant provider contract, credential, preload and IPC-registration tests are included in the focused run. Run `npm run validate` for the complete required pipeline.

No live provider-token or SSH browser smoke was performed: dedicated current public/private/fine-grained/Bitbucket token fixtures were not supplied. Authenticated browser navigation (especially Bitbucket's manual branch selection and Unicode/slash branches), real OS credential-store locking, and real SSH-host provider context remain manual checks before release.

## Remaining #145 acceptance criteria

- Explicit self-managed instance approval and host-bound credentials.
- Truthful typed API outcomes and visible permission/rate-limit/unavailable states. Existing provider methods can still conflate HTTP/network failures with no PR; this pass distinguishes context cancellation/deadline failure, not all API outcomes.
- GitHub Actions + legacy status aggregation, pagination and latest-effective reviews.
- Actual Bitbucket branch-head build status and verified current token/retired-app-password guidance.
- GitLab HEAD/pipeline association and approval accuracy.
- Checkout/upstream/remote identity, detached HEAD for full context, stale-result rejection and request deduplication/cache. Navigation is static or PR-only now, but the existing first-remote/full-context attribution is unchanged.
- Rate-limit-aware bounded retry policy and typed transport errors.
- Full provider contract and live local/SSH/checkout-change smoke coverage.

No PR is opened or authorized by this checkpoint.
