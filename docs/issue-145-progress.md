# Issue #145: credential-boundary hardening

This branch implements the security-first slice of [#145](https://github.com/Bynzski/clanker/issues/145), not the entire issue. No Git/Settings navigation redesign or Git credential-system changes are included.

## Implemented

- Provider detection requires exact hosted origins and unambiguous HTTPS/SSH repository URLs. Spoofed GitLab hosts cannot trigger token lookup or API dispatch. GitLab nested namespaces are preserved.
- Self-managed GitLab API context is **disabled**, rather than implicitly authorized by a hostname substring or given the global GitLab token. Explicit instance approval, separate instance-bound tokens, and host-correct enterprise links remain future work. Local/SSH Git operations on these hosts still work normally.
- Encrypted token retrieval fails closed if secure storage is unavailable or decryption fails. Linux `basic_text` is rejected for saving and reading. Stored ciphertext is preserved. Decryption error details are not returned.
- Stored-token retrieval is removed from preload. The legacy IPC channel explicitly denies retrieval, including direct renderer callers. Main-process provider requests retain access.
- All three providers use the shared timeout/retry transport. API requests must use the provider's fixed HTTPS origin, without URL credentials. Redirects are denied, including GitLab's custom `PRIVATE-TOKEN` header. Authentication HTTP failures are not retried.
- Credential UI no longer claims saved tokens authenticate Git commands or that the generated SSH private key is encrypted.

## Verification and limitations

Official GitLab [REST authentication](https://docs.gitlab.com/api/rest/authentication/) confirms the `PRIVATE-TOKEN` header. Electron's [safeStorage contract](https://www.electronjs.org/docs/latest/api/safe-storage) documents encryption availability and Linux's insecure `basic_text` fallback. Both were retrieved during implementation. No provider-specific PR/check/review endpoints or Bitbucket authentication scheme were changed in this slice.

Regression tests cover malicious remote variants, HTTPS/SSH hosted remotes, nested GitLab namespaces, directly constructed unapproved provider contexts, redirect-denying transport for each provider, authentication failures, unavailable/insecure storage, decryption errors, and denial of renderer secret retrieval.

No live provider-token smoke tests were performed: no dedicated current public/private/fine-grained/Bitbucket token fixtures were supplied. No live SSH provider smoke was performed.

## Remaining acceptance criteria

- Explicit self-managed instance configuration and host-bound credentials.
- Truthful typed API outcomes and visible permission/rate-limit/unavailable states.
- GitHub Actions + legacy status aggregation, pagination and latest-effective reviews.
- Actual Bitbucket branch-head build status and verified current token/retired-link guidance.
- GitLab HEAD/pipeline association and approval accuracy.
- Checkout/upstream/remote identity, detached HEAD, stale-result rejection and request deduplication/cache.
- Rate-limit-aware bounded retry policy and typed transport errors.
- Full provider contract and local/SSH/checkout-change smoke coverage.

Do not close #145 based on this patch.
