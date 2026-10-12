# Issue #145 follow-up

## Current completion review

The presentation and Bitbucket contract corrections below were merged in [PR #165](https://github.com/Bynzski/clanker/pull/165). Issue #145's remaining-scope text predates that merge: those code changes do not need implementing again. The official API-token page was fetched again during this review and still explicitly documents Bearer API tokens without an email. This verifies documentation, not authenticated acceptance.

The remaining live acceptance matrix below is **owner-deferred, not verified**. On 2026-10-12, the owner requested that #145 close when PR #173 merges, accepting deferral of the unperformed live matrix rather than claiming it passed. An existing GitHub CLI login is not a dedicated least-privilege test fixture and was not reused. The implementation/security suites and documentation are complete for the issue's approved closure scope; live acceptance remains an acknowledged limitation.

A further credential-read regression was found during this review: decryption could return an empty string with `success: true`. Full context refused it, but PR-only navigation checked `success` and could dispatch anonymously. Credential reads now reject empty, whitespace-only and oversized plaintext, preserve the ciphertext and return a sanitized error. Regression tests exercise both canonical context and PR-link paths and assert zero network dispatch. This is synthetic storage-failure evidence, not a real keyring lock/unlock test.

## Corrections

- Source Control Overview consumes normalized `ci` and `review` summaries, not their lossy legacy PR projections. CI is labelled **checkout HEAD** and is shown independently of PR discovery. Confirmed no checks, pending, success, failure and unknown/unavailable remain distinct.
- A summary with a problem always carries a partial/unavailable marker and problem code, including a known failure retained from incomplete pagination. Review `none` means no active review decisions or requests, not no submitted reviews: comment-only reviews can normalize to `none`. Confirmed PR absence makes review not applicable.
- An independently confirmed `found`/`none` PR outcome survives unrelated CI/review failure in both Overview and the Branches badge. Legacy responses without typed outcomes still fail closed on a context error. Loading hides previous summaries, and request identity/generation and checkout-change resets remain unchanged. Explicit Overview Refresh bypasses the provider cache; automatic reads retain caching.
- Atlassian's [Using API tokens](https://support.atlassian.com/bitbucket-cloud/docs/using-api-tokens/) was fetched directly during this follow-up. Its “Using Bearer authentication” section explicitly documents `Authorization: Bearer {api_token}` and says this removes the need for the Atlassian email. The existing origin-bound transport therefore already implements the documented API-token form. Settings and provider/configuration docs now describe it accurately; Basic auth is not required and no new secret IPC is introduced.
- Synthetic Bitbucket regression coverage verifies Bearer repository CI reads remain independent of a forbidden `/user` identity lookup. This is transport-contract evidence, **not live authenticated token acceptance**.

## Owner-deferred live validation (not performed)

No dedicated provider tokens, self-managed GitLab instance, registered SSH fixture or OS-keyring lock/unlock fixture were supplied for this follow-up. Do not reuse unrelated harness/Git credentials or infer repository permission from identity validation. The owner approved closing #145 on merge of PR #173 with this matrix explicitly deferred, **not marked tested**. Future live acceptance should use dedicated fixtures and record the results separately.

| Matrix | Status | Evidence required if resumed |
| --- | --- | --- |
| GitHub classic/fine-grained; public/private/limited scope; Checks + statuses; reviewers/dismissals; forks; stale/unpublished HEAD | Not performed | Tested scopes and repository visibility, normalized outcomes and UI |
| Hosted/approved self-managed GitLab; nested namespaces; fork and merged-results SHA; unavailable approvals; host/port isolation | Not performed | Instance/API versions, scopes, origin isolation and SHA association |
| Bitbucket scoped API token + access tokens; actual builds/reviews; identity denied vs repository allowed | Contract tested only | Live token type/scopes, repository visibility, CI/review outcomes |
| Local and registered SSH checkout/upstream/HEAD; branch/remote/context changes in flight; slash/Unicode navigation | Deterministic regression coverage only | Dedicated temporary local/SSH repositories and installed versions |
| Revocation, throttling, pagination and inaccessible sources | Deterministic regression coverage only | Live unavailable outcomes; no false absence/green state |
| OS keyring locked/unlocked; ciphertext preserved; decryption failures; no anonymous fallback | Deterministic regression coverage only | OS/keyring versions and real lock/unlock observations |

Use dedicated temporary repositories and least-privilege credentials. Record versions, scopes and expected/observed outcomes without tokens, ciphertext, raw response bodies or sensitive URLs. Follow the validation checklist in [VCS providers](vcs-providers.md) and, for SSH fixture safety, [remote VPS smoke testing](remote-vps-smoke-test.md). Self-managed enrollment remains main/bootstrap-only, not a Settings workflow.
