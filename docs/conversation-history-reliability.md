# Conversation history freshness and partial discovery

This is the first scoped implementation for #116. Chat History now asks for a
structured discovery result: usable sessions and compact provider issues. The
existing array-only preload method remains for callers that need just sessions.
Both methods use the canonical `SESSION_DISCOVER` channel and main's registered
workspace and installed-harness filtering.

Opening history bypasses main's 60-second cache. Delayed local warm-up may still
use it. Main caches only successful complete discovery; a refresh retires an
older entry even if the new scan fails. Cache invalidation and newer scans prevent
late completions from installing stale entries. Synchronous provider exceptions
are isolated like asynchronous failures.

Renderer memory keeps sessions and their warnings together, bounded to eight
workspaces. Dismissed, replaced and unmounted requests cannot write that memory.
A failed refresh preserves the remembered list with a visible error; partial
provider failure shows warnings alongside the successful conversations. Local
workspace identity is rechecked after discovery, as SSH identity already was.
Raw provider exceptions stay out of the IPC diagnostics response.

The local OpenCode CLI query requests 4,097 rows and rejects lists above 4,096,
matching SSH's bound rather than accepting a CLI default page. Malformed rows
are skipped; blank optional titles get a fallback, and absent timestamps no
longer pretend the session was just updated.

## Ordinary local resume/fork authority (#131)

Default-account selections now carry only a harness and native session ID as
launch authority. Before routing, offering/recreating a removed checkout, or
spawning, main forces fresh discovery across history's bounded checkout scopes
(including its one-unfiltered-scan fallback). Renderer cwd, file, model, provider
and checkout tags cannot choose launch metadata. Managed accounts retain their
owned-home lookup; SSH retains its authoritative host rediscovery.

Matching records are captured before display deduplication. Missing sessions,
malformed launch fields, conflicting cwd/file/model/provider evidence, selected
provider errors, or incomplete scope scans fail closed with compact diagnostics.
An unrelated provider failure does not block a verified selection. Native cwd is
canonicalized before routing so an in-workspace symlink cannot authorize an
outside conversation. Workspace closure/replacement/shutdown is rechecked after
awaits; provider validation cannot change the native identity or checkout route.
User defaults cannot override the chosen session with a provider's selection
flags; local and SSH share this guard, with local checks before checkout creation.

This verifies Clanker's handoff, not a live CLI's resume/fork behavior. No model
calls, synthetic prompts, native transcript edits or live-relocation enablement
are part of this slice.

## Verification

- All six local provider fixtures run through aggregation and detailed IPC,
  sorting, availability filtering, native argument building, and ordinary
  resume/supported-fork IPC handoffs using real readers/validators and a mocked PTY.
  Forged renderer launch metadata is ignored.
- A broken OpenCode listing keeps five other providers visible with a warning.
- Cache ordering, invalidation, retry after partial failure, warm-up cancellation,
  dropdown reopening and warnings alongside usable sessions have regressions.
- Existing local/SSH resume, account, worktree and path tests remain in the full
  `npm run validate` gate.
- On 2026-10-07, read-only inspection of installed Antigravity 1.3.1 confirmed
  the required SQLite columns and JSON-array `workspace_uris` representation.
  The installed OpenCode CLI accepted the explicit count and returned its expected
  ID/directory/title/created/updated fields. No conversations were launched or modified.

Manual smoke: open Chat History, create a native conversation, then reopen
history immediately (within a minute). The new conversation should appear.
Switch workspaces during discovery and check that results stay scoped. With one
installed provider's store unreadable, other providers should remain available
beside a compact warning; restore the store and reopen to clear the warning.

## Remaining work (#131, superseding #116)

This slice does not close the consolidated ticket. Remaining review includes
provider-parser malformed metadata, canonical history matching including unscoped
Antigravity rows, provider availability refresh, live provider-specific fork
semantics, the complete local/SSH/removed-checkout matrix, and live provider smoke.
A discovered row is still not a guarantee that the installed native CLI will
successfully resume it; all authority checks run again on invocation.
