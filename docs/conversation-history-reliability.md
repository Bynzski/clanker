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

## Verification

- All six local provider fixtures run through aggregation and detailed IPC,
  sorting, availability filtering and native argument building.
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

## Remaining #116 work

This scope does not close the broader ticket. Remaining review includes fresh
main-owned rediscovery for every local default-account resume (Pi and managed
accounts already have stronger identity checks), malformed metadata across other
providers, canonical workspace matching including unscoped Antigravity rows,
provider availability refresh, provider-specific native forks, removed-checkout
resume and live local/SSH provider smoke. This PR does not claim that every
discovered row has passed native resume validation.
