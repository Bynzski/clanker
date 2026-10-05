# Harness integration playbook

Clanker requests harness operations through the canonical main-process provider
registry in `src/main/harnesses/registry.ts`. CLI differences belong to providers;
PTYs, Windows command resolution, shells, caching, workspace security, SSH
execution and batching remain shared. The issue #60 migration preserves existing
UI controls, icons, ordering and workflows. Noninteractive invocation corrections
from the follow-up are documented below.

## Identity, descriptors and capabilities

- `src/shared/harnessIds.ts` defines `HarnessId`. Both the serializable descriptor
  record (`src/shared/harnessDescriptors.ts`) and the implementation registry are
  exhaustive records. Adding an ID without registering it fails typecheck.
- Descriptors contain ID, name, icon key and legacy catalog icon. Their AI commit
  metadata supplies the existing renderer picker and persisted provider type.
  `defineHarness()` requires this metadata to agree with the implementation;
  registry contract tests also check agreement. Main capability functions never
  cross IPC. The renderer keeps its React/SVG icon catalog and presentation order.
- `src/main/harnesses/<id>/index.ts` assembles one provider. `getHarnessProvider()`
  requires a validated `HarnessId`; `findHarnessProvider()`/`isHarnessId()` are
  explicit boundaries for raw persisted/IPC strings. Unknown IDs cannot silently
  fall through to another harness.
- Optional capabilities are absent when unsupported. Session operations describe
  `support: 'native' | 'emulated'` and optional transport restrictions. Local Agy
  fork is explicitly emulated resume; SSH Agy fork remains unsupported.
- `harnessCatalog.ts`, `sessionHistory.ts`, `sessionLaunch.ts`,
  `agentAttentionAdapters.ts` and `aiCommit.ts` retain compatibility APIs. Their
  command catalogs/support sets are projections, not independent registrations.

```ts
const provider = getHarnessProvider(harnessId);
const models = await provider.models?.discover();
const sessions = await provider.sessions?.discover(workspacePath);
// Consumers use the canonical boundary to enforce operation + transport support.
const invocation = buildSessionCommand(session, {
  operation: 'resume', transport: 'local', userFlags: flags,
});
```

Providers expose specifications as well as methods: a native CLI invocation and a
host Python scan are different mechanisms. Do not add no-op capabilities or
require every implementation to use one storage format.

## Current capabilities

All seven providers support local and SSH interactive launch. AI commit remains local-only.
Model discovery is local for every provider; Codex, OpenCode, Pi, OMP and Agy also expose an optional
`models.discoverInEnvironment(executor)` that runs their own list command and parser through the
selected environment's bound `HarnessCommandExecutor` (never an SSH target). Claude has no list command
and Hermes is not queried remotely; a failed or unsupported remote discovery yields no catalog, with no
local cache or static fallback. Only Codex, Claude, OMP, Hermes and Agy implement `usage` so far (see
"Usage capability"); OpenCode and Pi remain without it. Only Codex and Claude implement the
optional `accounts` capability (see "Accounts capability"). Only Codex, Claude and OpenCode implement the
optional, opt-in `agentBridge` capability (see "Agent MCP bridge"); Pi, OMP, Hermes and Agy do not.

| Provider | Local models | Local / SSH history + resume | Local fork | SSH fork | Local / SSH attention | AI commit |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | debug models | JSONL / JSONL | native | native | native hooks / native hooks | yes |
| Claude | absent | JSONL / JSONL | native | native | settings hooks / settings hooks | absent |
| OpenCode | models CLI + fallback | native CLI / native CLI | native | native | plugin / plugin | yes |
| Pi | list-models | JSONL / JSONL | native | native | extension / extension | yes |
| OMP | JSON catalog | JSONL / JSONL | native | native | extension / extension | yes |
| Hermes | local TUI gateway | absent | absent | absent | absent / observer plugin | absent |
| Agy | models CLI + fallback | SQLite / SQLite | emulated resume | absent | owned plugin / inert owned plugin | yes |

OpenCode's own CLI selects its SQLite/legacy storage. Clanker currently has no
SQLite-first/legacy filesystem reader for OpenCode to migrate. Its JSON and JSONL
session-list responses are supported. Do not replace this boundary with a new
storage reader as part of a provider change.

## Local execution and failure semantics

`launch` owns executable, base args, model flag and harness environment. Hermes
owns provider-qualified model decoding and its local TUI yolo environment bridge.
Shared argv construction receives the selected provider model builder explicitly;
it never derives a harness ID from an executable name. Serializable catalogs omit
this function. Session invocation requires an explicit transport and rejects
unsupported operation/transport pairs with `HarnessCapabilityError`.
User flags (including reasoning/effort options) remain opaque, whitespace-split
arguments in their existing order; this migration does not reinterpret them.
The common launcher retains the POSIX wrapper, fallback shell, cwd and PTY behavior;
on Windows every local PTY (terminal and session resume/fork) is planned by
`resolveHarnessPtySpawn()` from the final argv and child environment.

Model capabilities retain native parsers, intentional fallback lists, TTL and
explicit-refresh behavior. Discovery implementations load lazily. The shared
cache protects explicit refreshes from stale warmup completion. Detailed model
results retain a typed failure while the existing picker still receives its
current array/fallback. Codex's provider reports malformed model output as a typed parse failure. Its
compatibility wrapper and exported parser preserve the historical empty-list/cache
behavior through explicit compatibility metadata; changing that behavior is a
follow-up. Detailed results are a discriminated `success` result with independent
`cacheable` policy. A parse failure is always `success: false`; only the Codex
compatibility policy may cache its historical empty result.

Session providers own parsing, native argument generation, selection flags and
harness-specific validation. Shared aggregation normalizes IPC paths, limits
file concurrency, sorts results and retains the bounded workspace cache. Provider discovery-order
metadata preserves the original ordering of equal-timestamp results and host scans.
Missing stores legitimately yield no sessions; operational errors are retained
per provider and partial failures are not cached as a complete scan. Agy uses
its existing schema and global-workspace/title fallbacks; changed schemas fail.

`HarnessCapabilityError` distinguishes unsupported, binary unavailable, not
configured, command failure, timeout, parse failure, storage/schema change and
transport failure, preserving the original cause. `classifyHarnessFailure()`
classifies known boundary errors; it does not claim to understand every native
CLI's authentication diagnostics. Providers may throw a more specific typed
error. Never turn an operational failure into an absent capability. Compatibility
wrappers may retain today's public fallback/error messages without adding UI.

## Attention lifecycle

Attention is transport-specific: `provider.attention.local` and `.remote` are
separate capabilities. Local `plan()` distinguishes ready injection from a typed
configuration conflict. The legacy injection wrapper still returns null for a
conflict. Local `prepare(context)` returns launch args/env and an owned lease, or
null for that same conflict; operational preparation failures propagate.

```ts
// Main-process helper: src/main/agentAttentionAdapters.ts

const prepared = prepareLocalAttention(provider.descriptor.id, context);
try {
  // Shared launch engine applies prepared args/env and creates the PTY.
} catch (error) {
  prepared?.dispose();
  throw error;
}
// Dispose again on terminal exit; successful disposal is idempotent.
```

Shared orchestrators should use `prepareLocalAttention()` rather than calling
`provider.attention.local.prepare()` directly. The shared preparation boundary
owns configuration planning, lazy provider-resource creation and lifecycle
acquisition. `provider.attention.local` describes provider behavior;
`prepareLocalAttention()` is the canonical orchestration entry point. Callers
should not manually call `prepareResources()`: resource files are prepared
lazily in private provider directories.

Launch IPC disposes leases on preparation/registration failure, setup or PTY
failure, and terminal exit. Cleanup failures are logged without masking launch
errors or preventing broker retirement; failed disposal remains retryable.
Agy's owned plugin retains reference counting and ownership checks. Each
preparation gets a distinct lease, including repeated preparations for one
terminal, so out-of-order disposal cannot retire another user's plugin. Unknown
files remain untouched. The shared layer creates only the secure temp root,
observer and command bridge. Providers contribute `attention.prepareResources`
for their settings/extensions/plugin directories; `AttentionAdapterFiles` has only
generic command/resource-root paths. Generic infrastructure is created once;
only the selected provider prepares resources, cached in its own private directory.
Failed preparation removes that directory and remains retryable without damaging
other providers or generic infrastructure. Optional `disposeResources` owns provider shutdown
cleanup of provider-held state. (Agy has none: its plugin is persistent and fail-open.) The app removes the shared root afterward.

### Lifecycle contract

```text
native harness event
  -> provider-owned interpretation (src/main/harnesses/<id>/attention*)
  -> root/child + session/turn provenance
  -> canonical lifecycle event
  -> AgentAttentionBroker correlation (main process, the single lifecycle authority)
  -> revisioned AgentAttentionSnapshot (push: agent-attention-changed; hydrate: get-agent-attention-snapshots)
  -> renderer snapshot cache + UI acknowledgement watermark
  -> pure presentation selector
```

The broker publishes independent semantic facts, never UI concepts: `runtime`
(`unverified | idle | starting | running | failed`, turn id, start time), a durable
`pendingRequest` (id, owning turn, `input | approval | null` kind, evidence class),
`lastCompletion` (set only by an accepted foreground completion and never cleared by new
work) and `lastOutcome` (the latest completion, interruption, failure or session end, so an
older completion cannot resurface as a fresh Done). The revision is per terminal, advances
only on an accepted semantic change (never for stale, rejected, child or duplicate events)
and survives registration replacement. A retirement (`agent_exited`, PTY exit, release) is a
revisioned tombstone (`snapshot: null`); hydration only lists live registrations. The
renderer subscribes first, then hydrates, and keeps the newest revision per terminal
(tombstones included). Whether the user has seen a completion or request is a renderer
watermark over those revisions; it never changes lifecycle. `deriveAttention` projects
Needs Input, then Working, then Failed, then an unseen completion that is also the latest
outcome. A user-facing `Failed` shows no badge or navigation target; only Needs Input and
unseen Done are counted and jumped to.

Source authority is declared per provider (`attention.authority: full | partial`, and
`source: native | hook`) and arbitrated centrally (`attentionAuthority.ts`).
`full` structured authority suppresses every lower-confidence source. `partial` (Claude has
no interrupt hook; Pi and OMP expose no input waits) may accept narrowly scoped
provider-specific live-screen evidence through `receiveFallback`: a blocker only inside a
proven active turn, clearable only by fallback itself and always replaced by a structured
request; an idle-looking screen never changes state, and fallback can never create a turn
or a completion. No production screen detector exists yet because Clanker has no
trustworthy main-process access to live screen state, and PTY silence, generic prompt
patterns and scrollback parsing remain forbidden. `broker.explain(terminalId)` and
`CLANKER_DEBUG_ATTENTION=1` report why an agent is in its current state (safe metadata
only).

A terminal token proves *which terminal* emitted an event. It never proves that
the event belongs to the root user-facing session or its current foreground turn.
Providers own native semantics: which event is a root start, how root versus
child is proven, which event means the foreground is settled, and how a real
user-input wait is recognized. Hook-command providers (Codex, Claude, Agy) supply
an `attention.interpreter` module; the shared `command.mjs` bridge only reads the
bounded hook payload, calls that interpreter and forwards its sanitized result.
Pi, OMP and OpenCode contribute extension/plugin sources; Hermes contributes its
host observer plugin. The broker contains no harness-name switch.

The wire envelope carries `event`, `scope` (`root` or `child`, provider-asserted),
`sessionId`, `turnId`, optional `inputId` (matches a wait to its resolution),
`continuesSessionId` (only on `session_continued`), an optional `cwd` (see *Agent
location* below) and a diagnostic-only `nativeEvent`. Prompts, responses, tool
arguments and results never enter it, and the renderer receives only the approved
lifecycle event name.

`AgentAttentionBroker` is the sole lifecycle authority. Per terminal it tracks the
bound root session, the active turn, a bounded list of retired turns, pending
input and lifecycle. Invariants:

- Only a provider-asserted root `turn_started` binds an unbound registration. A
  completion or input event never establishes a root.
- Events whose `scope` is `child`, or is missing (unknown subject), cannot change
  state (`ignored-child` / `rejected-ambiguous`). Once a root is bound, another
  session cannot mutate it (`rejected-mismatch`).
- **Turn identity is mandatory.** Every start, input and completion event carries
  a `turnId`: the native turn ID where the harness has one (Codex `turn_id`,
  Claude `prompt_id`, Hermes `turn_id`), otherwise a provider-owned epoch the
  adapter keeps for one foreground turn (Pi, OMP and OpenCode in the extension;
  Agy in the bridge's per-terminal store). An event without one is
  `rejected-ambiguous`; there is no uncorrelated fallback.
- Completion and input events need the live turn: only the active `turnId` can
  settle it, and a completed or superseded turn is retired, so a late completion
  from turn A can never settle turn B and a retired turn cannot restart
  (`ignored-stale`). After Clanker itself submits a prompt, nothing can settle
  the turn until the native start event names it.
- `input_resolved` only clears an outstanding wait, and when the wait has an
  `inputId` the resolution must carry the same one.
- `session_continued` (`sessionId` = new, `continuesSessionId` = old) moves the
  bound root to a continuation the provider has proven (for example context
  compression) without touching turn, input or lifecycle state. It must name the
  currently bound root, otherwise it is rejected. It is not a session boundary and
  not an agent exit.

`session_ended` (native in-TUI boundary: clear, switch, delete) clears the root,
turn and pending input, returns the terminal to unbound and **keeps** the
registration so another session can bind in the same PTY. `agent_exited` is
emitted only by Clanker's wrapper (`command.mjs --ended`) or SSH cleanup when the
harness process itself exits to the fallback shell: it retires the registration,
so handoff becomes unavailable and the shell is an ordinary shell. PTY exit/kill
remains the unconditional final release.

### Agent location

A harness can move without its process changing directory (Claude Code tracks the
directory a Bash `cd` leaves it in, so an agent can leave, and even remove, the
worktree it was launched in). Providers report where the root agent is working as
`cwd` on any root event, or as a location-only `location_changed` event
(`sessionId` + `cwd`, no turn). The shared envelope forwards `cwd` only when it is a
printable path of at most 1024 bytes, otherwise it drops that field and still
delivers the event, and a failed `location_changed` delivery is not a failed bridge
transaction.

The broker (`agentLocation.ts`) canonicalizes the path in the registry's form
(resolved, POSIX, no trailing slash; host paths for SSH) and rejects an event whose
`cwd` is not absolute. Main then resolves it to the most specific checkout context of
the reporting terminal's own workspace (symlink-aware locally, lexical on the host).
Only the bound root session (or an unbound registration) can move the location;
children and other sessions cannot. A move rides in the same revision as the
lifecycle change of its event, otherwise it gets its own. The snapshot's
`location: { path, checkoutContextId }` survives `session_ended` and goes with the
agent on `agent_exited`.

Location is presentation only. Agent rows and the status bar show the reported
context (falling back to the launch context until a report arrives). It never
re-binds `terminal.checkoutContextId`, never authorizes a root, and never relaxes
release or removal checks, which stay on the launch binding.

What each provider reports (root only; mid-turn tool hooks and children never
carry a location):

| Provider | Can the location move? | Reported from |
| --- | --- | --- |
| Claude | Yes, a Bash `cd` persists (the process never moves) | `cwd` on `UserPromptSubmit`/`Stop`/`StopFailure`/`SessionEnd`; `CwdChanged` (`new_cwd`) as `location_changed` |
| Codex | Only `/cd` or a worktree switch, while idle (commands run one-shot) | hook `cwd` on `UserPromptSubmit`/`Stop`/`Interrupt`/`SessionEnd` |
| Pi | Only when the session is replaced (resume/new/fork) | `ctx.cwd` on `agent_start`/`agent_settled`; `session_start` as `location_changed` |
| OMP | Only on a session switch or explicit directory change | main-session `ctx.cwd` on `agent_start`/`session_stop`; `session_start`/`session_switch` as `location_changed` |
| OpenCode | Per session (`info.directory`) | the verified root session's directory (else the plugin's instance directory) on its turn events |
| Antigravity | No (per-command `Cwd`); hooks carry no cwd | the root conversation's `workspacePaths` when it has exactly one |
| Hermes (SSH) | Yes, its terminal keeps a persistent `cd` | the turn task's active **local** terminal environment `cwd` on root `pre_llm_call`/`post_llm_call` (a container backend reports nothing) |

A move is shown once it is reported: immediately for Claude, at the next turn
boundary for the others.

**An agent left in a removed directory.** Codex spawns every hook command in its
session directory and has no hook setting for another one, so once an agent
removes the worktree it runs in, *no* hook can start (Codex reports `Hook failed:
No such file or directory`), including the `Stop` that would end the turn. The
provider declares `attention.hooksRunInAgentDirectory`; when checkout
reconciliation finds a context gone, main calls `markLifecycleLost` for every
such agent whose reported location is in it: the open turn and any wait are
retired without a completion and the agent shows no state instead of Running
forever. A later native turn start (after `/cd` to a directory that exists)
recovers normally. Claude's hooks keep running in that situation and in-process
plugins/extensions are unaffected, so only Codex declares it. Adding a provider means emitting `cwd` from its
interpreter or plugin; nothing in the broker or renderer is harness-specific.

Set `CLANKER_DEBUG_ATTENTION=1` to log one bounded diagnostic per accepted-envelope
event: harness, terminal ID, native event class, truncated session/turn IDs,
semantic and the decision (`accepted`, `ignored-child`, `ignored-stale`,
`rejected-mismatch`, `rejected-ambiguous`). No payload content or credentials are
logged. There is no debounce or delay anywhere: a wrong event is wrong whenever it
arrives, and terminal text is never parsed.

### Hook-bridge state transactions

Hook commands are separate short-lived processes, and some interpreters (Codex, Claude,
Agy) keep bounded per-terminal state. The shared `command.mjs` bridge therefore runs each
read -> interpret -> write -> deliver transaction under an exclusive per-terminal lock.
Delivery is inside the critical path so the broker observes transitions in state order (an
event derived from state a hook produced can never be overtaken by a later hook's event);
delivery is bounded and a failed delivery counts as a failed transaction. The lock is an atomically created directory (`.clanker-state-<hash>.json.lock`,
no `flock`, so it also works on Windows) holding a `pid:nonce` owner record; state is
replaced by an atomic temp-file rename. Waiting is bounded (about 1.2 s; Clanker-owned Codex and Claude hooks use a 3 s timeout) and is synchronization only: elapsed time never decides agent state. A holder
that is dead, or older than the stale bound, is replaced by an atomic rename only if its
owner record is unchanged; a live holder is never broken.

Fail closed. If the transaction cannot be established (lock not acquired in time, state
unreadable, corrupt, oversized or unwritable) the interpreter runs against empty state, a
private poison marker is created, and no `input_resolved` is delivered until a turn
boundary (`turn_started`, `turn_completed`, `turn_interrupted`, `turn_failed`, `session_ended`) is
delivered by a healthy transaction. Evidence of a possible human wait is still delivered.
State, poison, temporaries and a crashed holder's lock are private launch files: local
cleanup removes the whole launch root, and SSH cleanup removes exactly those names (never
recursively) before the root. Codex bounded structures: completed-call bookkeeping
(32 calls, 64 done ids) may be trimmed because that can only leave a wait unmatched or
unresolved (fail closed); live waits (16) are never trimmed: past the cap the state is
`overflow` and no individual `PostToolUse` resolves anything until `Stop`, `Interrupt`,
session end or a new turn.

### Trusted resume identity

`trustedRootSessionId()` returns the native session ID Clanker itself validated
for a non-fork resume, and only for providers that declare
`attention.resumePreservesSessionId`. The local path (`sessionIpc`) and the SSH
path (`invokeRemoteSession`, from the host-rediscovered session) pass it to
`broker.register()/registerRemote()`; SSH also forwards it to
`prepareSshAttention()` (`AttentionPreparationContext.rootSessionId`) so provider
host configuration can use it (OpenCode). Forks, fresh launches, renderer-supplied
IDs and providers whose resume may assign a new ID (Claude) start unbound.

### Authoritative events per provider

Fields below are the native ones the adapter relies on (identity = which field proves
the root session; turn = the turn identity; child = how child scope is proven).

| Provider | Root start (identity / turn) | Input wait / resolution | Completion (Ready) | Never completes / child scope | Session boundary |
| --- | --- | --- | --- | --- | --- |
| Codex | `UserPromptSubmit` (`session_id` / `turn_id`) | `PermissionRequest` (no `tool_use_id`) correlated with `PreToolUse`/`PostToolUse` calls (see below) | root `Stop`; root `Interrupt` ends the turn without a completion (`turn_interrupted`) | `SubagentStop`, events with `agent_id`, other threads, legacy `notify` | `SessionEnd` |
| Claude | `UserPromptSubmit` (`session_id` / `prompt_id`) | `PermissionRequest` (no `tool_use_id`) = turn-level wait / `PostToolBatch` for the same prompt | root `Stop` (background tasks and crons do not hold the turn open), `StopFailure` = `turn_failed` (Failed, never Done) | events with `agent_id`; `Notification` is not used (no turn or request identity) | `SessionEnd` |
| OpenCode | `session.status` busy of a verified top-level session (parentage from `client.session.get`, or the trusted resumed ID) / plugin epoch | `permission.asked`/`question.asked` (`id`) / `*.replied`, `question.rejected` (`requestID`) | verified-root `session.status` idle (the legacy `session.idle` duplicate is absorbed by the closed epoch) | sessions with a `parentID`; sessions with unknown parentage | `session.deleted` |
| Pi | `agent_start` (`ctx.sessionManager` session ID / extension epoch) | not reported | `agent_settled` | `agent_end` and lower-level events | `session_shutdown` |
| OMP | `agent_start` where `ctx.agent.kind === 'main'` (session ID / extension epoch) | not reported | main `session_stop` (OMP defers it until agent-owned background jobs are idle); it is the terminal foreground completion | `agent_end` is not terminal completion; `ctx.agent.kind === 'sub'` sessions (and unknown kinds) never settle the pane | `session_shutdown` (main) |
| Agy | `PreInvocation` #0 (`conversationId` binds as root / bridge-store epoch) | ask tools `PreToolUse` / `PostToolUse` of the same tool | `Stop` with `fullyIdle === true` for the root conversation | `Stop` with `fullyIdle` false/absent, other conversations | none native |
| Hermes (SSH) | `pre_llm_call` with empty `parent_session_id` (`session_id` / `turn_id`) | `pre_approval_request` / `post_approval_response`, human surfaces only, tied by `turn_id`, request identity `tool_call_id` (else `pattern_key`) | `post_llm_call` of a turn that began as a root turn | child turns (`pre_llm_call` with a `parent_session_id`, remembered by `turn_id` and session); turns never seen start; `surface="smart"` approvals | `on_session_finalize` for the root |

Claude permission lifecycle. `PermissionRequest` carries `tool_name`/`tool_input` but no
`tool_use_id`, so there is no exact request identity. The interpreter records, in the
bridge's private per-terminal store, that the current `prompt_id` has an outstanding
permission wait (a boolean; the tool input never leaves the hook, is never stored, sent
or logged) and reports one `input_requested` with the constant `inputId` `permission`.
Only `PostToolBatch` (fired once after every call of a parallel batch has resolved)
reports `input_resolved`; per-tool `PostToolUse` is deliberately not subscribed, so an
unrelated parallel tool finishing cannot clear the wait. A denied call resolves with its
batch. Cost: after approval the pane stays Needs Input until the batch finishes. Child
(`agent_id`) permission and batch events are ignored. `StopFailure` (turn ended on an API
error) is explicit failure evidence: it is reported as `turn_failed` (Failed), never as a
completion, and the error text is never forwarded. Claude has no user-interrupt hook,
so an interrupted turn stays Running until the next prompt or `Stop`.

Codex permission correlation. `PermissionRequest` has `turn_id`, `tool_name` and
`tool_input` but no `tool_use_id`; `PreToolUse` and `PostToolUse` carry `tool_use_id`.
The interpreter remembers each `PreToolUse` as `{tool_use_id, 16-hex fingerprint of
tool_name + canonical tool_input}` and binds a `PermissionRequest` to every unfinished
call with the same fingerprint (identical parallel calls form one group). A wait resolves
only when all of its calls have a `PostToolUse`; the broker sees one `input_requested`
for the first wait and one `input_resolved` once none remain. A request that matches no
started call, or a call the user denies (no `PostToolUse`), fails closed: the wait lasts
until `Stop`, `Interrupt` or session end. Only ids and fingerprints are stored. Whether
`PreToolUse` and `PermissionRequest` carry byte-identical `tool_input` for every tool has
not been verified live; a mismatch degrades to the fail-closed behavior. Root `Interrupt`
maps to the generic `turn_interrupted`: it retires the turn and any wait, keeps the root
bound and leaves the terminal available, without a Turn complete alert; a later `Stop`
of that turn is stale.

Hermes details. `post_llm_call` does not carry `parent_session_id`, and approval hooks
carry `session_key` (a gateway/TUI key that can be a stale compression parent), not a
normal root session ID. The plugin therefore remembers each `pre_llm_call` turn as root
or child and ties `post_llm_call` and approvals back to it by `turn_id`; an unseen turn
is dropped (fail closed). Hermes can rotate `agent.session_id` on context compression,
which no plugin hook announces. The plugin reports a legitimate rotation as
`session_continued` only when native data proves it: the turn began under the bound root
(`turn_id` is `<session at turn start>:<task>:<id>`) or Hermes's own state records a
`compression` lineage from the root (a child row whose parent ended with
`end_reason='compression'`; delegation children do not qualify). An arbitrary new
session ID is not trusted. Limitation: if the lineage cannot be read (state database
unavailable) a rotation between turns, such as manual `/compress`, fails closed.
`subagent_start`/`subagent_stop` are not needed: child turns announce themselves through
`pre_llm_call`.

Codex hooks are injected with `-c hooks.<Event>=…` as session-flag hooks. Upstream
dispatches internal memory-consolidation Stops only to managed hooks (user, project,
session-flag and plugin hooks are filtered out), so they cannot become Ready. A user
`[hooks]` table, hooks for these events in `config.toml`/`hooks.json`, a `profile`
setting, a profile flag or a `hooks.`/`profile` override is a conflict and attention
stays unavailable; the local and SSH parsers accept the same forms. Codex runs
non-managed hooks only after the user reviews them (`/hooks`), and the trust is keyed
by the hook definition, so POSIX hooks reference the launch's command and interpreter
through `$CLANKER_ATTENTION_COMMAND`/`$CLANKER_ATTENTION_INTERPRETER` (remote:
`CLANKER_REMOTE_ATTENTION_*`) and the definition is identical for every launch: one
review persists. Until reviewed no events arrive and the pane stays unknown.

### Remaining limitations

- A provider that does not report a native boundary on an in-TUI session switch
  (Agy has no end event; Codex `SessionEnd` currently reports reason `other`)
  stays bound to the old root and fails closed (unknown) until the harness
  restarts. Pi, OMP, Claude, OpenCode and Hermes report one.
- An interrupted turn with no settle event stays Running rather than Ready.
- Claude work resumed by a background wake-up after a settled `Stop` is not
  re-marked Running until the next prompt. Claude events need `prompt_id`
  (Claude Code 2.1.196 or newer); without it nothing is reported.
- Codex hooks, OMP `ctx.agent`, OpenCode `client.session.get` and Hermes hook
  kwargs follow upstream documentation; they have not been verified against live
  billable sessions here.

## SSH ownership and batching

Providers contribute `sessions.remote` specifications (storage roots, event
parsing, optional native CLI command and resume file-store confinement). The
shared host runtime supplies bounded file reads, result emission and canonical
workspace matching. The SSH orchestration layer owns target selection, execution,
timeouts, response limits, duplicate checks and transport errors.

File-backed providers are gathered in one host execution. OpenCode keeps its
native list request with `--max-count 4097` plus host canonical-path validation.
All six session providers together still use three executions, not one execution
per provider. Registry-derived host binary probing remains one shell command.

Attention providers contribute host configuration guards, launch injection,
runtime requirements, selected-provider temporary resources, allowed environment
keys, owned plugin payloads and optional plugin-enable commands.
SSH owns secure directory installation, locking, temporary files, fresh
terminal-scoped credentials, OSC transport and cleanup. Persistent owned Agy and
Hermes observer plugins remain inert without launch credentials; per-launch
files are recorded in a private manifest. Cleanup validates manifest paths,
ownership, modes and non-symlink file types before removing only listed resources;
unknown files are preserved. Adding a provider requires no central filename list. Concurrent cleanup
requests coalesce; subsequent cleanup can retry after unknown files are removed.

Intentional transport differences remain: remote scans are recursive and bounded;
local scans keep their existing formats/limits/fallbacks. Pi and OMP history
aggregation retains conventional roots. Trusted Pi invocation separately resolves
configured agent/session roots and stored session-directory flags. SSH Agy requires canonical workspace evidence and
rejects fork, whereas local discovery keeps its global-session fallback and
emulated fork. SSH inference and local Hermes attention remain absent.

## Adding a harness or capability

1. Verify the installed CLI contract without making a billable model call. Record
   native commands, storage formats, supported platforms and unverified behavior.
2. Add its `HarnessId` and serializable descriptor, then implement/register one
   provider. Defaults migration uses the canonical ID list. Keep React icons in
   the renderer; adding an icon or keyboard shortcut is presentation work.
3. Implement only genuinely supported capabilities in that provider. Preserve
   native semantics and specify native/emulated session operations and transport
   restrictions. Keep workspace/path validation authoritative at IPC/transport
   boundaries, with harness-specific session validation in the provider.
4. For SSH, contribute bounded host specifications and configuration guards.
   Extend shared transport mechanisms only when needed; preserve batched
   execution and fail-closed ownership/credential checks.
5. Add registry/delegation/fixture tests, exact launch/resume/fork argv contracts,
   failure cases, attention cleanup/concurrency tests and remote execution-count
   checks. `harnessArchitecture.test.ts` automatically scans shared main-process
   TypeScript, including shared `harnesses/*.ts` infrastructure, against new
   harness-ID dispatch. Only provider directories derived from `KNOWN_HARNESS_IDS`
   and the exhaustive registry are excluded; scalar identity metadata remains
   allowed. Run focused tests, typecheck and lint; finish with `npm run validate`.

For a future capability, extend `HarnessProvider` and implement it under the
relevant provider. Do not add a new central harness switch/support allowlist.
`usage` is an optional extension point; see "Usage capability" below. Existing AI commit
uses `buildInvocation({ model, prompt })` to return command, args, optional stdin,
timeout and optional environment. Optional provider output parsing unwraps native
CLI envelopes before shared commit-message normalization. Compatibility command,
args and timeout values derive from `buildInvocation()`; `modelArg` is descriptive
legacy metadata, not executable authority. Git context and prompts
stay shared; Windows resolution and desktop PATH remain in the executor. There
is no remote inference or general inference framework.

## Agent MCP bridge (issue #102)

> **Native provider signals tell Clanker what the agent is doing. MCP lets the agent intentionally ask
> Clanker to do something.** MCP is a transport and capability boundary, never the source of truth.

The bridge is one small, authenticated agent → Clanker capability plane owned by the main process. It
exists so a future Clanker-owned operation is implemented **once**, behind one authorization boundary,
instead of once per harness. It ships three tools: the read-only `clanker_context`, and the two high-level checkout
transactions `clanker_create_isolated_checkout` and `clanker_complete_isolated_checkout` (see "Isolated checkout
lifecycle").

### Lifecycle versus MCP

| | Native lifecycle (attention) | Agent MCP bridge |
| --- | --- | --- |
| Answers | what is the agent doing (working / done / needs input) | what can the agent ask Clanker to do |
| Source | the harness' own hooks / plugins / extensions | the agent, on purpose, through a tool call |
| Authority | `AgentAttentionBroker` | main-process services, via the authenticated session |
| Credential | attention credential (`CLANKER_ATTENTION_*`) | MCP credential (`CLANKER_MCP_TOKEN`) |
| Provider code | `HarnessAttentionCapability` | `HarnessAgentBridgeCapability` (separate) |

MCP traffic is **never** lifecycle evidence: no tool call, listing or connection changes an agent's
attention state, and there are deliberately no model-invoked *attention* tools (`clanker_i_am_done` and
the like). A model can forget, be late, or be a subagent; a native event cannot. The checkout transactions
below are a different thing: operations Clanker performs on resources it owns, never reports of what an
agent is doing. The two credentials
are independent, minted by different code, validated by different code, and not interchangeable
(a test asserts an attention token never resolves as a bridge credential).

### Pieces

- `src/main/launchAttachments.ts`: the generic launch-attachment lifecycle (below).
- `src/main/attentionLaunchStep.ts`: existing attention preparation expressed as a launch attachment
  (behavior unchanged).
- `src/main/agentBridge/credentials.ts`: launch-scoped credential registry.
- `src/main/agentBridge/server.ts`: loopback Streamable HTTP endpoint (official
  `@modelcontextprotocol/sdk`, stateless, JSON responses).
- `src/main/agentBridge/capabilities.ts`: the agent-callable capability set (`clanker_context`) and
  `defineCapability()`.
- `src/main/agentBridge/lifecycleCapabilities.ts`: the two checkout transactions as capabilities, written
  against a port; they contain no Git, registry or terminal code.
- `src/main/isolatedCheckout/`: `IsolatedCheckoutService` (the transactions) and `rehomeSupport.ts` (which
  harnesses can be re-homed).
- `src/main/agentBridge/service.ts`: `AgentBridgeService` (server lifecycle, leases, live authority
  checks) and `agentBridgeLaunchStep()`.
- `src/main/harnesses/<id>/agentBridge.ts`: the thin provider attachments (Claude, Codex, OpenCode).

### Identity and security model

- **Loopback only.** The listener binds the literal `127.0.0.1` on an ephemeral port and verifies the
  bound address; it never binds a wildcard or LAN interface. Requests must carry exactly that
  loopback `Host` (DNS-rebinding guard) and no `Origin` header (agents are not browsers). It starts on
  first use, is owned by main, and closes (dropping open connections) at quit. There is no daemon.
- **One credential per launched terminal.** At launch main mints `clanker_mcp_v1_<256-bit CSPRNG>`
  bound to main's own record `{ terminalId, workspaceId, environmentId, checkoutContextId, harnessId }`.
  Only a SHA-256 digest is retained server-side; the raw token exists in the launch environment
  (`CLANKER_MCP_TOKEN`) and nowhere else: not in argv, not in a config file (providers reference the
  variable by name), not in logs. Everything is in memory. In main the raw token is transient: it exists
  while the child environment is composed and is not retained afterwards. The attachment coordinator
  keeps only disposer functions (never an attachment's args/env), the bridge's disposer holds only the
  registry's revoke closure, and the terminal's `onExit` holds only the coordinator's `dispose`. Tests
  force a GC and assert the lease and the composed attachment are collected while revocation still works.
- **Identity comes from the credential, every request.** The server is stateless: each request is
  authenticated before its body is read, and the resolved grant is closed over by a short-lived
  protocol server. Tools declare closed schemas; **any undeclared argument is refused**, so a model
  cannot hand a tool a workspace, terminal, checkout or harness. The renderer never participates.
- **Executable input boundary.** A capability declares its input once with `defineCapability({ input })`
  (`src/main/agentBridge/input.ts`): flat, closed objects of booleans, bounded strings (optionally enums)
  and bounded integers. The same declaration produces the advertised JSON Schema **and** the parser, and
  `run()` receives only the parsed, typed value. Undeclared (including `__proto__`/`constructor`),
  missing, mistyped (no coercion: `"true"` is not a boolean), out-of-range, nested or array values are
  refused before the capability executes. Error text names the field and rule, never the value.
- **Live authority re-check.** On every `tools/list` and `tools/call` the service re-derives the caller
  from main's live state: the terminal must still exist in main's terminal table with the same
  workspace, checkout context, harness and environment, and the workspace and checkout context must
  still be the registered ones (`WorkspaceRegistry`). A closed workspace, released context or exited
  terminal ends authority even if revocation has not yet run. Capabilities receive that resolved
  caller only.
- **Revocation.** The credential is revoked first when the launch attachment is disposed: PTY exit,
  `KILL_TERMINAL`, workspace cleanup and quit all funnel through the terminal's `releaseResources`,
  and a failed or aborted launch disposes the same attachment. Revocation is idempotent and happens
  before provider cleanup, so a cleanup failure cannot leave authority behind.
- **Bounds, fail closed.** 64 KiB request bodies (checked against `Content-Length` and while
  reading), 16-message batches, 32 concurrent requests, 8 KiB headers, 15 s to *receive* a request
  (HTTP-level only), 64 KiB tool results (refused, never truncated). Tool execution has its own bound: 10 s
  by default, or the capability's declared `timeoutMs` (never more than 60 s; the checkout transactions
  declare 30 s). Execution is cut off at its bound and its `AbortSignal` is aborted (also when the client
  disconnects or cancels). The signal is cooperative: a capability that ignores it gets its response cut off
  but its work may continue, so a mutating capability must honor `signal` and be safe to abandon, and the
  checkout transactions are written that way (see below). Malformed JSON, wrong content type, non-POST methods,
  unknown paths and unknown tools are refused; tool failures return a generic error, never internals.
- **Scoping.** A credential is issued a set of capability names; `tools/list` shows only those and an
  ungranted name behaves as unknown. A capability may `require` something of the launch
  (`checkout-rehoming`): only launches whose harness can be re-homed, with agent attention on, are granted the
  checkout transactions, so an unsupported agent never sees a tool that is guaranteed to fail.
- **Output discipline.** `clanker_context` returns display-safe facts about the caller's own launch
  only: workspace folder name, `local`, checkout kind / isolated / branch, harness, launch directory
  *relative to the checkout root*, and granted capability names. No tokens, ids, absolute paths, other
  terminals or other workspaces.

The agent's own child processes inherit `CLANKER_MCP_TOKEN` (they are the agent). That is the same
authority as the agent itself, and the credential dies with the terminal.

### Generic launch attachments

`prepareLaunchAttachments(base, steps)` is the one lifecycle for resources a launch acquires. Attention
and the bridge share **only** this mechanism, not semantics or credentials.

- A step is `{ name, optional?, prepare(state) -> PreparedHarnessAttachment | null }` and a prepared
  attachment is `{ args?, env?, dispose() }`. `args` is the complete argv derived from the argv the step
  was handed (so a step can insert before a `resume` subcommand); `env` is additive.
- Steps run in order and each sees the earlier result; `env` additions merge deterministically (later
  wins). A step returning `null` is skipped.
- A required step that fails rolls back every earlier attachment (reverse order) and rejects with the
  original error. An **optional** step (attention and the bridge) that fails releases itself, is
  reported by name/message only, and the launch proceeds without it, so neither can break an
  ordinary launch or each other.
- `dispose()` is idempotent, runs in reverse order, never throws, and one failing disposal does not
  stop the others. `terminalIpc` and `sessionIpc` hold a single `attachments` value: on PTY spawn
  failure they `await attachments.dispose()`; on exit it is the terminal's `onExit`.
- The coordinator retains only each attachment's bare `dispose` (it must not rely on `this`), so an
  attachment's args/env are collectable once composed. Its default error report names the step and phase
  only and never prints exception text, because a future attachment's errors might carry a credential.
- Both fresh launches (`SPAWN_TERMINAL`) and local resume/fork (`SESSION_INVOKE`) use it. Stale
  `CLANKER_MCP_*` (and `CLANKER_ATTENTION_*`) variables inherited from an outer process are stripped from
  every launch, case-insensitively, since Windows environment names are case-insensitive.

### Provider capability

`HarnessProvider.agentBridge?: HarnessAgentBridgeCapability` is optional and distinct from `attention`.
Shared code owns the server, credential, identity binding, capability set, validation and revocation;
the provider owns only how *its* CLI receives the one shared server. `prepare(context)` gets the
endpoint URL, the shared server name (`clanker-grid`), the **name** of the token variable (never the
token), the argv/env so far, and a lazily created private (`0700`) scratch directory that shared code
removes on disposal. It returns a prepared attachment or `null`, and `null` means "do not attach":
the user already owns this name or channel. A provider that cannot attach without replacing or
disabling user MCP configuration omits the capability. There is no no-op support, and
`defineHarness()` plus the descriptor's `agentBridge` flag keep metadata and implementation in step.

Verified against the installed CLIs (Claude Code 2.1.289, Codex 0.160.0, OpenCode 1.18.34) without
relying on remembered flags; each attachment was exercised against a real bridge instance:

| Harness | Mechanism | User config | Credential |
| --- | --- | --- | --- |
| Claude | extra `--mcp-config <scratch>/claude-mcp.json` placed last (it is variadic); no `--strict-mcp-config` | merged with user/project/local servers; skipped when the user passed `--strict-mcp-config` | header `Bearer ${CLANKER_MCP_TOKEN}` expanded from the environment |
| Codex | `-c mcp_servers.clanker-grid.url=…` and `….bearer_token_env_var="CLANKER_MCP_TOKEN"`, before a `resume`/`fork` subcommand | overrides merge per key; `codex mcp list` shows the user's own servers beside ours; skipped if the name is already defined on the command line or in `config.toml` | `bearer_token_env_var` |
| OpenCode | `OPENCODE_CONFIG_CONTENT` with an `mcp` entry | deep-merged over every other config source; skipped if the user already sets the variable | `Bearer {env:CLANKER_MCP_TOKEN}` |

Intentionally **unsupported** (capability absent):

- **Pi**: MCP servers come only from `~/.pi/agent/mcp.json` and a trusted project's `.pi/mcp.json`.
  There is no launch-scoped channel; relocating the agent directory would replace sessions and auth,
  and writing either file would modify user (or project) configuration.
- **Oh My Pi**: `--config` loads an overlay for the run, but support for MCP servers in that overlay
  was not verified, and no other launch-scoped channel exists. Not faked.
- **Hermes** and **Antigravity**: MCP servers live in persisted configuration managed by
  `hermes mcp add` / `agy mcp add`; there is no launch-scoped override.

### Opt-in

The bridge is **off by default** and does nothing unless the user enables *Clanker bridge (MCP)* for a
supported harness (`harnessDefaults[harness].agentBridgeEnabled`, shown only for harnesses whose
descriptor advertises `agentBridge`). Only local launches bound to a registered workspace and checkout
context attach it; plain shells, unbound legacy launches, unsupported harnesses and SSH launches launch
exactly as before.

### Local-only V1 and the SSH direction

SSH launches never attach the bridge, and `AgentBridgeService.lease()` rejects non-local identities. A
future SSH design should forward the desktop-owned bridge over the existing OpenSSH connection with an
ephemeral, launch-scoped tunnel (no remote daemon or installation, no reusable desktop credential, the
tunnel dies with the launch/workspace). Nothing in V1 (loopback listener, per-launch credential bound to
main's records, stateless requests) prevents that.

### Adding a Clanker capability

Add a `defineCapability({ name, description, input, run })` entry to `DEFAULT_AGENT_BRIDGE_CAPABILITIES`.
No provider changes. `run(input, { caller, signal })` receives validated input and the live-resolved
caller, honors `signal`, and must
call an existing validated main-process service rather than re-implement authorization; where the
behavior today lives only in renderer → IPC code, extract a main-process service and have IPC and the
capability both call it. Arguments describe the operation only, never identity. Keep results bounded and
display-safe. Do not add attention (working / done / needs-input) tools.

### Attaching the bridge to another harness

Verify the CLI's *launch-scoped, additive* MCP mechanism first (flag, env or an owned temp file) and that
it merges with user servers. Then add `src/main/harnesses/<id>/agentBridge.ts` that returns args/env
referencing the token by variable name, returns `null` on conflicting user configuration, and add the
`agentBridge` flag to the descriptor. Write temp files only through `scratchDir()`. If no such mechanism
exists, leave the capability absent and document why here.

### Isolated checkout lifecycle

An agent can ask Clanker to move its own conversation into a fresh Clanker-owned worktree and, when it is done,
back to the main checkout, without ever naming a path, workspace, terminal or checkout:

| Tool | Input (operation data only) | Effect |
| --- | --- | --- |
| `clanker_create_isolated_checkout` | `branch` (1-200 chars, validated by Git) | new worktree on a new branch, same conversation resumed inside it |
| `clanker_complete_isolated_checkout` | `deleteBranch?` (boolean) | same conversation resumed in the main checkout, then the worktree is removed and its context released |

These are **transactions, not Git wrappers**. There is deliberately no create-branch, create-worktree, adopt,
change-cwd, switch-checkout, delete-worktree or delete-branch tool: each exposes an unsafe ordering and allows
a split between where the conversation runs and what Clanker thinks it owns. The workspace, terminal, checkout,
harness and every path come from the authenticated caller and main's own state; the checkout being completed is
`caller.checkoutContext`, resolved from the terminal's launch binding in main.

**The lifecycle tools are authoritative when granted.** Inside Clanker, creating and finishing an isolated
checkout is Clanker's job. An agent that has these tools should use them instead of `git worktree add/remove`,
`git branch -d/-D` on the checkout's branch, Claude's `EnterWorktree` / `ExitWorktree`, Codex's `--worktree`, or any
manual cwd switching: Clanker must track the checkout and move the same conversation with it. Everything else
stays normal (edits, commits, pushes, pull requests and merges use ordinary Git and GitHub tools; there are no
PR or Git tools in the bridge). Outside Clanker, or for a launch that was not granted the tools, provider-native
behavior is unchanged: nothing intercepts shell commands or disables a provider's own worktree feature.

**Guidance is discoverability, not security.** Authorization is the credential, the grants and main's live state;
nothing depends on the model reading or obeying text. Smoke tests showed why the text matters anyway: with the old
wording ("nothing here is required for normal work") Claude chose `EnterWorktree`, and Codex ran
`git worktree remove`. Three layers now carry the rule:

1. *Tool descriptions* (some harnesses show only names or descriptions before loading a schema) say when to use
   the tool, name the competing mechanisms, and say why Clanker must own it.
2. *MCP server instructions*, built from what the credential was **granted** (`bridgeInstructions`): a launch with
   only `clanker_context` is never told it owns worktree lifecycle or pointed at tools it cannot call.
3. *A launch-scoped instruction channel for harnesses that do not surface server instructions.* Codex defers
   MCP tools behind `tool_search` and, asked, reported seeing neither the tool nor any server instructions, so it
   never reached for it. Its provider therefore adds `-c developer_instructions="<the same guidance>"` to the launch.
   It is added **only when the user has no `developer_instructions` of their own** on the command line, in
   `config.toml` or via a profile; a user's instructions are never replaced or merged by guessing (the bridge still
   attaches, without the guidance). Nothing is written to the project or to the user's config.

Observed in the real app (Claude Sonnet 5.5, Codex with GPT-6 Luna), starting from the single sentence
"create a branch and worktree with any name and make a small edit to one file", with the guidance in place:
both chose `clanker_create_isolated_checkout` and neither used a native worktree mechanism; and from
"make a small edit, commit it, merge it into main and clean up when done" both finished with
`clanker_complete_isolated_checkout` and no manual removal. This is behavior of those models in those runs, not a
guarantee.

**Who gets them, and why `resumesWithoutOriginalDirectory` is not enough.** `sessions.resumesWithoutOriginalDirectory`
only says a conversation can be resumed once its original directory is gone. It does not say a *running*
conversation can be moved. A provider therefore declares an explicit `checkoutRehome` capability
(`HarnessCheckoutRehomeCapability`: `mode: 'hot-replace' | 'after-turn'`, an optional explicit target-directory
option and writer-contention recognition), and `rehomeSupport.ts` grants the tools only when the provider has that
*and* a native local `sessions.resume`, a way for the CLI to run the conversation elsewhere (either
`resumesWithoutOriginalDirectory === true`, or a provider-owned native `checkoutRehome.relocateConversation`),
local attention (the live conversation's native session id comes from native
lifecycle events, never from the model) and the bridge. That is **Claude (`hot-replace`), Codex (`after-turn`) and
OpenCode (`after-turn` with native relocation)**. Pi, Agy, Hermes and OMP are not granted the tools (OMP proves resume from another directory but has no
bridge to ask through). The launch also needs native attention to have **actually attached** to it, not just the setting: the attention launch step
provides a generic `native-attention` launch fact only when the provider's hooks/plugin were prepared (a provider declines on
user-owned config such as Claude `--bare`, Codex `--profile`, OpenCode `--pure`/`OPENCODE_CONFIG_DIR`; the harness still
launches), and the bridge step reads it (`LaunchAttachmentState.provided`) to decide the grant. Attention and the bridge stay
separate attachments and credentials. Shared code never branches on a harness name:
it reads the provider's declared mode.

**Re-homing is a real resume** of the same native conversation in the target checkout, through the launch every
history resume uses (`SessionIpcController.resumeInCheckout`, the body of `SESSION_INVOKE` with main's routing
decision; not reachable through IPC). Main re-finds the conversation by harness and native id in its own history
(`findSession`: managed accounts and worktrees included, and it **bypasses the history cache**, because the cache
can predate a conversation that began after the renderer last listed history; observed as a first-turn "not
found").

| Harness | Strategy | Mechanism | Evidence |
| --- | --- | --- | --- |
| Claude | `hot-replace` | `claude --resume <id>` started in the target directory (launch directory decides; no target option) while the first process waits in the request | one session file continued across main -> worktree -> main in the real app |
| Codex | `after-turn` | after the native root Stop: retire the first process, then `codex ... resume <id> -s ... --cd <target>` | measured below, plus the real app |
| OpenCode | `after-turn` + `relocateConversation` | after the native root idle: retire the first process, move the conversation's recorded directory with OpenCode's own `move-session`, then `opencode --session <id>` | measured below, plus the real app |

**OpenCode (measured with 1.18.34, isolated XDG profile).** `opencode --session <id>` ignores both the process
directory and `--dir`: it runs in the directory *recorded in the conversation*, so resuming alone never re-homes it
and a removed directory is not recoverable that way. The one native operation that changes the record while keeping
the session id is `POST /experimental/control-plane/move-session` `{sessionID, destination: {directory}}` (204;
`session list` then reports the new directory and a later resume runs there; no file is touched because
`moveChanges` is never sent). OpenCode refuses a destination outside the conversation's project (400, so a worktree
of the same repository is fine, `/etc` is not) and a relative path (500); a refusal changes nothing. Clanker reaches it
through a transient `opencode serve` owned by that one call (`harnesses/opencode/rehome.ts`): loopback, a free port,
a fresh random `OPENCODE_SERVER_PASSWORD`, Basic auth, killed in every outcome. The service never names OpenCode: the
provider's `relocateConversation` runs before *every* replacement attempt with the source already retired, so
recovery relocates back before it resumes, and a refusal fails the attempt (nothing is resumed in the wrong
directory). OpenCode is `after-turn` because a second process cannot be shown safe next to a live one (it shares the
SQLite store and the live process owns the session); its native `session.status` busy/idle is the turn boundary the
attention plugin already reports. The target comes only from the main-owned checkout context. `opencode session list`
lists only the project of its working directory (empty from an unrelated one), so history discovery now runs it inside
the workspace (or, for the `<repo>-worktrees` container, inside its first checkout); without this a conversation that
lives in a worktree was never found. **Guidance:** OpenCode concatenates the `instructions` array across config
sources (measured: the user's entry stays, ours is appended), so the lifecycle guidance is one launch-owned file in
a fresh 0700 temp directory referenced from `OPENCODE_CONFIG_CONTENT` and removed by `dispose`; no project file and no
user config is touched. Real runs (big-pickle): explicit create -> same session id, `pwd`, `clanker_context` and status
bar agree -> edit, commit, merge -> explicit complete removed the worktree and the branch; unprompted
"please create an isolated worktree and branch and make one small edit" called `clanker_create_isolated_checkout`;
"make a small edit, create a PR, merge it and clean up when done" created the checkout, merged (a local bare origin
has no PR, so by push) and called `clanker_complete_isolated_checkout` unprompted. As with Codex the agent's turn ends
at the move; the user (or the next prompt) continues in the new checkout.

**Why Codex cannot be hot-replaced.** Measured with Codex 0.160.0 in an isolated `CODEX_HOME` (so as not to
touch real conversations): Codex runs threads in a shared per-`CODEX_HOME` app-server daemon, and that daemon, not
the TUI, holds the thread's writer lock (`thread-writer-locks/<id>.lock`). While a TUI is attached to a thread, or a turn
is still running after its TUI was killed, a second `codex resume <id> --cd <other>` does **not** fail: it attaches to
the live thread, which keeps its original working directory (the header and `pwd` still showed the source). Only
once the turn has completed and no TUI is attached does `resume <id> --cd <other>` take effect immediately; the
thread's `pwd` is then the new directory. So a hot replacement can silently produce a UI that says "target" while the
thread works in the source. The binary also contains `failed to acquire thread writer lock` and `... is already
running with a different rollout path`; those were **not reproduced** by any flow above, so Codex's provider treats
exactly those strings as a transient contention to retry (at most 3 attempts, 250 ms apart) and nothing else.

**Create (`hot-replace`).** (1) authenticate; re-check live terminal, workspace and local-only; (2) a re-homeable
harness and a bound native session; refuse a worktree workspace (judged from Git's listing) and an already isolated
caller (idempotent `already-isolated`); (3) find the conversation, *before any mutation*; (4) validate the branch (Git's
`check-ref-format` decides; an existing branch is never taken over, except this workspace's own idle attached
checkout for it, a retry); (5) base from Git now; (6) create and attach through `New isolated agent`'s path; (7)
`checkout-attached`; (8) start and prove the replacement; **commit**; (9) hand off; (10) report.

**Create / complete (`after-turn`).** The request is *accepted*, not performed. Create does steps 1-7 (the worktree
is created and attached now, and stays visible whatever happens next); complete does the same preflight (nobody
else uses the checkout, Git lists it unlocked or it is already gone, nothing unsaved). Then one `PendingMove` is
recorded and the tool returns normally with `{ status: 'scheduled' }` and a message telling the agent to finish its
reply. The agent's turn completes normally.

- *Key:* one pending move per source terminal, bound to the terminal, its native session id, workspace, source and
  target checkout, harness and kind. A repeated identical call returns `already-scheduled`; a different kind is
  refused. The model supplies none of these.
- *Trigger:* the broker's own published change for **that** terminal, whose snapshot is bound to **that** native
  session and whose `lastOutcome` is a **completed** root turn recorded **after** the request (a revision baseline, so an
  earlier completion or an approval prompt never triggers). The broker already drops child/subagent lifecycle, so a child
  Stop cannot; another terminal's Stop, another session's Stop and a stale completion cannot.
- *Interrupt, failed turn, session end:* **cancel** the pending move (nothing moves behind the user's back; a user
  notice says so; a created checkout is kept). The terminal disappearing drops it. Shutdown drops it.
- *At the trigger,* everything is re-validated (the world may have changed during the turn; checkout identity is compared
  by value, since Git reconciliation legitimately replaces context objects): terminal, workspace, session, both
  contexts, and for complete again "no other terminal / not dirty / not locked". A move that is no longer valid is cancelled
  *before the source is touched*.
- *Source retirement:* only then is the source retired completely through `retireTerminal` (process killed, attachments
  disposed, attention released, bridge credential revoked, removed from the terminal table), and Codex is never killed
  inside the MCP request.
- *Resume:* the same thread is resumed with the provider's explicit `--cd <target>` (any `-C`/`--cd` the user's flags
  carried is replaced; the path is the native path of a main-owned checkout context, never from MCP, the renderer or the
  model) and proven exactly as for hot replacement. Ordinary history resume keeps its exact arguments; only
  Clanker re-homing forces a target.
- *Recovery:* if the target resume fails (after the bounded contention retry), the same thread is resumed back where it
  was (create: the original checkout; complete: the isolated checkout, if it still exists). If that works the pane adopts
  it and the user is warned. If both fail, nothing is removed, released or deleted, the checkouts and branch stay and
  stay visible, success is never reported, and a strong notice says to resume from history. A failed re-home is never followed
  by cleanup.
- *Only after the replacement is proven* (complete): release the context (existing protections), inspect and remove, optionally
  safe-delete the branch.

**Proof before commit.** The replacement must produce output within a deadline, survive a short observation window
(a resume that cannot find its conversation prints an error and exits at once), be registered in main's terminal table
bound to the target context and harness, have an attention registration, and the target must still be the registered
context of the same registered workspace.

**Handoff (`hot-replace`).** `terminal-replaced` is sent first so the pane adopts the replacement; then the
requesting process is retired **before any response is written**, so it can never append a result to the transcript
the replacement already loaded. The agent never receives that result; the resumed conversation sees an interrupted
call and, if it repeats it, gets `already-isolated` / `already-complete`. For `after-turn` the source was already retired
before the replacement existed, so the order is source retired, replacement proven, `terminal-replaced`.

**Credential rotation.** Nothing is mutated in place. The replacement is a fresh launch, so it gets a *new* bridge
credential bound to its own terminal id and the **target** checkout (and the same grants and guidance); the old
credential is revoked when the old terminal is retired (before the replacement exists, for Codex).

**Attention.** The replacement goes through the normal launch (native hook -> interpreter -> `AgentAttentionBroker`).
For Codex the source registration is released before the replacement registers, so there is never more than one
authoritative root for the conversation; Claude's two registrations coexist only between spawn and handoff, while the
replacement is idle. A provider whose resume preserves the session id seeds its root (Codex); Claude binds on its
first event, so its replacement shows `unverified` until its next turn. MCP traffic is never lifecycle evidence.

**Renderer.** Main sends `AGENT_CHECKOUT_TRANSITION` events (`checkout-attached`, `terminal-replaced`,
`checkout-released`, `notice`) in the order things became true. The renderer only applies them (`replaceTerminal` swaps
the terminal inside the same pane, keeping layout position and name; contexts are upserted or removed; the old xterm is
disposed first) and cannot start, confirm or alter a transition. The status bar, sidebar and rail read the active
terminal's checkout, so they follow. For Codex the old pane briefly shows its process as exited between source retirement
and `terminal-replaced`. A replacement whose pane no longer exists is closed rather than left untracked. A `notice`
(status bar) tells the user each outcome, including a scheduled move, a cancelled move and partial cleanup.

**Failure and rollback.** Before the commit point (hot replacement) everything rolls back to the starting state: the
replacement is retired and the original keeps running. A worktree `create` already made is **kept** and announced so it
is listed as an inactive checkout; nothing is deleted to recover, and a retry reuses it. After the commit point the
conversation lives in its new home and the rest is finished, never rolled back: a refused release, a failed removal (for
instance system Trash unavailable), a dirty checkout or a failed branch deletion leave the checkout and branch in place and
say so. An exception in any post-commit step is a partial cleanup, never "left where it was". `git branch -d` only: a branch Git
does not consider fully merged into the main checkout's current branch is kept (a squash merge never pulled locally looks
unmerged).

**Cancellation and timeouts.** The tools declare a 30 s bound. For hot replacement a cancel or timeout before the commit point
aborts and rolls back; past it, the abort is ignored and the transaction finishes under `IsolatedCheckoutService`'s
ownership (tracked; shutdown waits). The `after-turn` request itself returns immediately; the move that follows is owned
by the service the same way.

**Known limits of this feature.**

- Claude, Codex and OpenCode, local workspaces, native attention attached to the launch. SSH is refused.
- Claude (`hot-replace`): the agent's current turn is cut off at the move and not continued; the resumed conversation waits
  for the next prompt. Codex (`after-turn`): the turn completes, then the conversation continues in the target on the next turn.
- The replaced pane gets a new terminal: its scrollback is rebuilt from the resumed TUI.
- Codex asks its own approval for MCP tool calls and for commands outside its sandbox; those prompts are the user's.
- The guidance reaches Codex only when the user has no `developer_instructions` of their own; otherwise Codex may choose
  its own worktree commands, and Clanker does not intercept them.
- A worktree an agent creates itself (`.claude/worktrees/...`, `git worktree add`) is not adopted by Clanker.
- Removal uses the system Trash (the existing path); where it is unavailable the checkout is left and reported.
- Not verified: Codex against a real GitHub pull request flow (the smokes merged locally into the main checkout).

### Known limitations

- Local launches only; three harnesses (the checkout transactions: Claude and Codex).
- A user who already defines an MCP server named `clanker-grid` in a place Clanker does not inspect
  (Claude's own configuration, OpenCode's merged configuration) may see the two collide for that launch;
  which one wins was not verified. Codex checks `config.toml` and the command line; Claude and OpenCode
  rely on the distinct name.
- Harness tool-approval prompts still apply to every bridge tool (the Claude smoke allow-listed them).
- `clanker_context` reports `branch: null` for the main checkout (its context does not record one).
- No OAuth discovery endpoints; a client that probes them gets 404 and uses the bearer header.
- A crash can leave a `clanker-mcp-*` scratch directory in the system temp area. It holds only a config
  with no credential (the credential never touches disk).

## Accounts capability

Accounts are an **optional capability layered onto the provider registry**, not a parallel framework
and not a redesign around accounts. The governing requirement: *a user with one normal Codex or
Claude account never has to know the feature exists.* Selection is deliberate and manual. There is
no automatic routing, no quota-based switching, no fallback to another account, no
workspace-to-account routing and no model-to-account routing.

### Contract

`HarnessDescriptor.accounts?: { support }` is canonical metadata, like `usage` and `aiCommit`, and
`defineHarness()` rejects metadata without an implementation (and the reverse). Only Codex and Claude
advertise it. `provider.accounts` (`HarnessAccountsCapability`) owns exactly the provider-specific parts:

| Provider owns | Shared code owns |
| --- | --- |
| authentication protocol/commands (`authenticate`, `verify`, `logout`) | opaque account IDs, selection, persistence |
| the account-environment variable (`environment(home)`) | owned-directory allocation and path safety |
| provider-side verification and sign-out cleanup | environment scoping and IPC validation |
| session discovery against a managed home (`discoverSessions(workspace, home)`) | launch binding, session provenance, usage orchestration, UI-safe projections |

Nothing in shared code names `CODEX_HOME`, `CLAUDE_CONFIG_DIR` or a harness (tests enforce this). A
future provider adds `accounts` to its descriptor and implementation; `HarnessAccountService` needs no
edit.

### Default (native) account

The default account is a synthetic projection (`id: 'default'`), never a stored record. It sets **no**
environment variable (`CODEX_HOME` / `CLAUDE_CONFIG_DIR` stay exactly as the user's own environment has
them), creates no directory, auth file or prompt, and changes no launch, resume/fork or usage behavior.
It cannot be removed. A user who never chooses *Add account* sees only `Account · Default` and an
unobtrusive *Add account* action.

### Managed accounts and selection

`HarnessAccountService` (`src/main/accounts/`) is the single owner. Its metadata lives in a dedicated
store (`harness-accounts`), **not** in `harnessDefaults` (which the renderer reads and writes):

```text
StoredHarnessAccount { id, harness, environmentId, kind: 'managed', label?, createdAt, email?, plan?, status? }
selections: "<environment>\0<harness>" -> managed account id   (absent = default)
```

No provider tokens, OAuth URLs, raw auth responses or renderer-supplied paths are ever persisted.
Selection is `environment + harness -> account`, remembered across restarts. Removing the selected
account falls back to the default account. Labels are free text and not unique; the opaque ID is the
identity. Status is `connected | needs-auth | unknown`; a failed probe only marks an account
`needs-auth` and never deletes it.

**Selection affects future launches only.** A running terminal keeps the environment it was spawned
with; a launch against a `needs-auth` or missing account fails with a safe message and never falls
back to another account.

### Managed directory ownership

`AccountHomeStore` derives `<userData>/harness-accounts/<harness>/<acct_<32 hex>>/` entirely in main
from a validated harness name and an opaque ID (`^acct_[0-9a-f]{32}$`). The renderer only ever names
an ID, which main resolves to an owned path; it can never supply `CODEX_HOME`, `CLAUDE_CONFIG_DIR` or
any path. Directories are created `0700` where the platform supports modes. Every use lstat/realpath
verifies a real directory strictly inside the real owned root; symlinks anywhere on the chain, traversal
and identity mismatches fail closed. Removal deletes only a verified owned directory and refuses any
provider-native home (`~/.codex`, `~/.claude`) even if misconfigured. **Removing an account never
means deleting the user's provider-native configuration**, and native auth is never copied into a
managed home. A managed directory that cannot be proven safe is never deleted, and removal of that account is refused.

Managed records are **local-only in v1**: on load, records scoped to any other environment are
dropped, and `resolveBinding()` refuses a managed account for a non-local environment, so a tampered
registry can never make a remote identity resolve a local home.

### Settings and Usage surfaces

The Settings account row is scoped to the focused workspace's real environment ID (local only when no
workspace is focused); an SSH workspace therefore receives `managedSupported: false` and no add flow.
A sign-in flow remembers the environment+harness that started it and is cancelled before any scope
change or unmount; late events from an old scope are ignored. When a harness has several accounts the
Usage panel adds *Add account* / *Manage accounts*, which only close Usage, open Settings, expand that
harness and pass a one-shot renderer hint to the existing account row: Usage owns no account lifecycle.
A selected managed account whose home is unusable stays visible in Usage as the active account
("Not signed in") and is never replaced by default; launches refuse it the same way.

### Durable state and cleanup sequencing

Registry changes are transactional: `commit()` builds the next state from a copy, saves it, and only
then publishes it in memory and emits change events. A failed save leaves the previous state (and
every published record) untouched and surfaces the fixed message "Account settings could not be
saved"; raw storage errors never cross IPC, and background status marking (Usage) swallows them.

- **Add:** `authenticate()` returning means the provider verified the account, so a cancel/shutdown that
  races after that point does not undo it (success wins); a cancel before it wins. If the new record
  cannot be saved, or the add fails/cancels after the provider CLI ran, the owned home is deleted only
  after provider logout succeeded or proved `unauthenticated`; otherwise it is kept.
- **Orphan recovery:** a kept home (and, at startup, any validated owned `<harness>/acct_<32hex>` home
  with content and no registry entry, excluding in-flight adds) becomes a local `needs-auth` record, so
  the user can reconnect or remove it. Nothing outside the owned root is scanned, nothing is treated as
  authenticated, and no secrets are stored.
- **Remove:** prove sign-out → delete the verified home → save the registry without the account → emit
  `removed`. A failure at any step keeps the account ID, metadata and selection and emits nothing; a
  retry recreates the trusted home if needed, re-proves sign-out and finishes. An unsafe home found at
  deletion time fails the removal.
- **Reconnect:** the refreshed identity/status is saved atomically or not at all; an existing account's
  home is never rolled back.

### Authentication flows

Flows are owned by the service (opaque flow IDs, one per account, at most four at once, a 5-minute
bound, cancelled on window close/renderer loss/quit). Progress is a narrow main→renderer event keyed
by flow ID: `starting | waiting-for-browser | connected | failed | cancelled`. Provider output is never
forwarded: failures map to fixed product messages. A new account is persisted only after verified
sign-in; failed or cancelled adds delete their directory. Sign-in URLs are opened by main (http/https
only) and never round-trip through the renderer. Removal first cancels the account's flow, then asks
the provider to sign out (secure-store cleanup), then removes metadata and the owned directory;
existing terminals are not killed. **Removal fails closed**: credentials may sit in the provider's
secure store, so deletion proceeds only when logout succeeded or the provider definitively reports
`unauthenticated` (nothing left to sign out). A missing CLI, a version without logout support, a
timeout, any other failure, or storage that cannot be verified keeps the metadata, ID, selection and
home untouched, emits no removal event and returns a fixed safe message. Shared code never deletes
keychain entries or credential files itself.

**Codex** uses the structured app-server API (verified against codex-cli 0.160.0's generated schema):
`initialize`, `initialized`, `account/login/start {type:"chatgpt"}` → `{loginId, authUrl}`, the
`account/login/completed` notification **matching that `loginId`**, then `account/read` under the same
`CODEX_HOME`; only a usable ChatGPT account counts. The client has a single read pump (the only `readLine()` consumer), so cancel responses cannot be stolen. Cancel sends `account/login/cancel` for the active
login (bounded) before the process is reaped; delete uses `account/logout`. Credentials may live in a file, the OS
keyring or another secure store: Codex derives that namespace from the canonical `CODEX_HOME`, so one
isolated home per account isolates accounts in every mode. Clanker never reads, parses, swaps or forces
the format of `auth.json`, and it does not use Codex's internal `account/sessions/*` types.

**Claude** uses the supported CLI surface (claude 2.1.288) with `CLAUDE_CONFIG_DIR` set to the owned
home: `claude auth login --claudeai` (the CLI opens the browser; stdout/stderr, which can contain the
sign-in URL, are drained and discarded), then `claude auth status --json` for machine-readable
verification (a signed-out status exits 1 with valid JSON, so stdout decides). It never types `/login`,
scrapes the TUI or stores OAuth tokens. `auth status` can refresh credentials, so it runs only at
lifecycle points (after login), never on a timer.

### One launch-preparation seam

`prepareHarnessAccountContext()` / `HarnessAccountService.resolveBinding()` is the only place account
environment is produced. Fresh terminals (`terminalIpc`) and resume/fork (`sessionIpc`) call it once and
merge `binding.mergeEnvironment(harnessEnv)` into the same environment that feeds attention preparation
(Codex attention follows the managed `CODEX_HOME`). Usage and auth go through
`bindHarnessExecution()`, which wraps an environment's executor so providers receive only bound
executors and never a path, SSH target or variable. The default binding is a no-op and passes requests
through untouched.

### Session provenance

Managed homes hold their own native history. Codex/Claude discovery now take a trusted root (default:
the native home) so **one parser** serves native and every managed home; the service aggregates them
and stamps `HarnessSession.accountId` (absent for default; never a path). The renderer's `accountId` is
a claim only: for resume/fork main resolves the account, **rediscovers the session inside that
account's own storage** and launches that authoritative copy (cwd/model/file path are not trusted) with
that account's binding. Resume/fork always use the account that owns the session, never the currently
selected one; a rewritten `accountId` cannot move a session to another account; a removed or
disconnected owner is a safe explicit error. A session without provenance resumes under the native
account. The local session cache key is the workspace path plus, only when managed accounts exist, the
account-set generation (bumped on add/remove/reconnect), so stale provenance is never served and
default-only caching is unchanged.

### Usage

Usage consumes the existing `HarnessUsageContext.accountId` seam and does not own accounts. The cache,
in-flight map and backoff are keyed by `environment + harness + account` (default keeps the bare
harness key), so one account's failure or backoff never suppresses another. Managed probes run through
an account-bound executor (`app-server` under the managed `CODEX_HOME`; the Claude control-protocol
probe under the managed `CLAUDE_CONFIG_DIR`). With managed accounts, a harness returns one entry per
account (selected first) carrying `account: { id, name, selected }` (Clanker's opaque ID only); a
default-only user gets the unchanged single entry. Probe outcomes may mark a managed account
`connected`/`needs-auth`. Selecting from the Usage panel calls the account service.

### SSH (v1)

Every SSH environment keeps its own native provider authentication, and *SSH + default account*
behaves exactly as before. Managed accounts are **not available for SSH environments yet**: `list`
returns `managedSupported: false` with a safe reason, add/reconnect are rejected, and no local path or
credential is ever applied to, copied to or synced with a remote host. The capability stays
transport-aware (it runs through the environment's executor) so remote managed accounts can follow.

### Deliberately out of scope

AI commit keeps its own settings and default behavior; model discovery is not account-specific (a
launch can fail normally if a model is unavailable to the chosen account); OpenCode, Pi, OMP, Hermes and
Agy have no account capability. IPC is `harness-accounts:*` (list, select, add-start, reconnect,
auth-cancel, remove, rename, plus the auth-state event): plain strings only, validated in main, with
fixed product messages as the only error text.

## Usage capability

Future usage support means **implementing `provider.usage`** in
`src/main/harnesses/<id>/` (for example `codex/usage.ts`) and assigning it in that
provider's `index.ts`. Do not add the harness to a central allowlist, switch or
adapter map; `harnessArchitecture.test.ts` scans shared main code for that.

```text
renderer --workspaceId--> usageIpc --> HarnessUsageService
                                          | WorkspaceRegistry.getWorkspace(id)
                                          v
                          provider.usage.get({ executor, transport, signal })
                                          | executor.run(request)
                                          v
                          WorkspaceEnvironment.executeHarnessCommand
                           /                                     \
              executeLocalHarnessCommand              executeSshHarnessCommand
              (bounded child process)                 (SshCommandExecutor + saved target)
```

Ownership: the **provider decides what to execute and how to parse it**; the
**environment decides where and how it runs**. A provider receives only
`HarnessUsageContext` (`executor`, descriptive `transport`, `signal`, optional
`accountId`/`modelId`). It never sees an SSH target, an environment object,
Electron, credential paths or renderer input, and must not spawn processes or
write separate local/remote implementations. Authentication stays with the
harness CLI (ask the CLI to make its own authenticated request; do not read auth
files or scrape a TUI).

`HarnessCommandRequest` (`harnesses/commandExecution.ts`) is the transport-neutral
request: bare `command`, `args`, optional `cwd`, `env`, `stdin`, `timeoutMs`
(default 10 s, max 30 s) and `maxOutputBytes` per stream (default 256 KiB, max
1 MiB). Both transports share `normalizeHarnessCommand()` validation (no path-like
executables, NUL bytes, invalid env names or `CLANKER_ATTENTION_*` variables).
Non-zero exits return `{ stdout, stderr, exitCode }`; use `requireSuccess()` when a
zero exit is required. Timeout, output overflow, cancellation, a missing binary
(local resolution/`ENOENT`) and SSH transport failure (255) throw
`HarnessCapabilityError` (`timeout`, `output-limit`, `aborted`, `binary-unavailable`,
`transport-failure`). Providers should throw `unauthenticated` when the CLI
reports a signed-out state, `parse-failure` for unrecognised output, and tolerate
schema drift.

Local execution reuses the desktop PATH augmentation and strips attention
credentials. It does not use the legacy `cmd.exe /c` form (interactive PTY launches now share
the same planner through `resolveHarnessPtySpawn()`): `environment/boundedSpawn.ts` plans the launch. POSIX runs the command directly.
On Windows it resolves the bare name through PATH/PATHEXT; a missing executable is
`binary-unavailable`; `.exe`/`.com` run directly so argv keeps its boundaries and
metacharacters (`& | < > ^ % "`) are inert; `.cmd`/`.bat` (npm shims) must go
through `cmd.exe /d /s /c` because Node refuses to spawn them directly, so
arguments are escaped (cross-spawn rules, never `shell: true`) and arguments
containing `%` or CR/LF are rejected with `command-failed` since `cmd.exe` cannot
carry them safely. PATH is merged case-insensitively on Windows.
Remote execution always goes through `SshCommandExecutor` for the registered
environment's target, with the same remote CLI PATH setup as other host probes.
An environment without `executeHarnessCommand` yields `unavailable`; there is no
fallback to the local machine.

Remote exit statuses are not interpreted as availability: a remote `127` is the
provider's command result. Whether a harness is installed comes from the
environment's own `probeAvailableHarnessIds()` (one batched `command -v` SSH call),
which the service runs once per request, shares across providers and reuses for
60 s (a manual refresh re-checks). Missing harness -> `not-installed` with no
probe; no usage capability -> `unsupported`; an empty/failed availability answer
is inconclusive (that method cannot distinguish "none installed" from "SSH
failed"), so probes proceed and report their own outcome. SSH exit `255` is mapped
to `transport-failure`; a remote program that itself exits 255 is
indistinguishable without redesigning `SshCommandExecutor`. The effect is bounded:
the harness shows `unavailable` and is retried only after backoff.

`HarnessUsageSnapshot` keeps the #60 measurement model (kind, arbitrary unit,
used/remaining/limit, reset, period, scope). Additions: measurement `label`, and
`scope.accountLabel`/`planLabel` for display. `scope.accountId` is an opaque
grouping key. The service caches the validated main-process snapshot including
it (`getCachedSnapshots()`, main only) and strips it only when building the
renderer entry. Percent-only sources use
`unit: 'percent'`. Nothing assumes 5-hour/weekly/monthly windows, and nothing sums
quota across harnesses; the same subscription can appear via several harnesses
(source harness -> provider -> account -> measurement), and identity must not be
invented when no reliable key exists.

`HarnessUsageService` (`src/main/usage/`) resolves capabilities generically from
the registry and takes an authoritative `workspaceId` (resolved through
`WorkspaceRegistry`; the renderer cannot supply targets, paths or credentials).
Providers without `usage` report `unsupported`. Probes are isolated per
provider, bounded by a 45 s deadline and cancelled on shutdown. Results are cached
per environment object (local and SSH accounts never mix), deduplicated while in
flight and refreshed per the provider's `refresh` policy: `cacheTtlMs` (ordinary
freshness; default 5 min) is what a normal request honors and a manual refresh may
bypass. `minimumProbeIntervalMs` (hard provider limit) and `failureBackoffMs`
(default 60 s, hard) are never bypassed by `force`, nor is Clanker's 10 s
manual-refresh floor. Entries report `nextRefreshAt` (cache) and `refreshableAt`
(earliest manual refresh). A failed refresh keeps the last good reading flagged
`stale`. There is no background polling. If the workspace closes or is replaced during a request, the
request fails rather than returning data to another workspace. Snapshots are
validated and copied field by field; renderer errors are fixed per-category text,
never raw stderr.

### Two execution forms

Both are environment-owned (provider decides *what*, environment decides *where/how*), validated by
the same `normalizeHarnessCommand()` rules, and enforce timeout, output bounds and cancellation.

1. **One-shot bounded command** — `context.executor.run(request)` returns
   `{ stdout, stderr, exitCode }` after the process ends. Use it for everything simple (OMP,
   Hermes, Agy).
2. **Interactive bounded stdio session** — `context.sessionExecutor?.open(request)` returns a
   `HarnessCommandSession` for stateful, line-oriented protocols (for example a JSON-RPC
   handshake over stdio). It is deliberately a separate seam, not an overload of `run()`.
   `sessionExecutor` is absent when the environment cannot provide one.

Stateful protocols must use the session seam, never a shell pipeline, an "all lines in one stdin
string" trick, EOF-shutdown races, arbitrary sleeps, a provider-spawned child, or a local-only path.
The provider owns the protocol (framing, request ids, matching responses, ignoring unrelated
notifications); the session layer only moves UTF-8 lines and knows no protocol or harness.

`HarnessCommandSession`: `writeLine(line)` (appends one `\n`; rejects after `closeInput`/failure,
for lines containing CR/LF/NUL, and past the total input cap with `input-limit`),
`readLine()` (next stdout line with LF/CRLF stripped, `null` on clean EOF, never filters,
rejects on timeout/abort/output overflow/transport failure), `closeInput()` (idempotent, ends
stdin without declaring success), `wait()` (`{ stderr, exitCode }` after the process is reaped; a
non-zero program exit is a result), `dispose()` (idempotent, safe in `finally`, terminates and
awaits reaping). Providers receive no `ChildProcess`, PID, SSH target/argv, descriptors, executable
path, environment object or Electron object.

Limits: the request timeout (default 10 s, max 30 s) bounds the whole session lifetime; stdout and
stderr are each capped cumulatively by `maxOutputBytes` (default 256 KiB, max 1 MiB), which also
bounds an unterminated line, so no unbounded buffering; total input is capped at 64 KiB. Exceeding
them terminates and reaps the process (`output-limit`/`input-limit`/`timeout`). The usage
`AbortSignal` terminates the process (SIGTERM, then SIGKILL after 1 s) and `HarnessUsageService`
disposes every session a provider opened when the probe ends, however it ends.

Local sessions reuse `planLocalLaunch()` (the one-shot executor's PATH handling, attention-credential
stripping, Windows PATH/PATHEXT resolution, direct `.exe`/`.com` launch, escaped `.cmd`/`.bat`
through `cmd.exe /d /s /c` with unsafe arguments rejected, `windowsHide`, never `shell`). SSH
sessions share `SshCommandExecutor.buildInvocation()` (target validation, BatchMode/ConnectTimeout,
quoting, PATH setup, cwd, remote env, attention filtering) with `exec()`; the OpenSSH client is
wrapped by the same session core and an exit of 255 or signal death is a `transport-failure`,
not a program exit (the documented 255 ambiguity is unchanged; 127 is not interpreted). There is no
remote-to-local fallback. The interactive PTY terminal launcher is untouched. No provider uses
the session seam yet.

### Usage adapters

All five adapters live beside their provider (`codex/usage.ts`, `claude/usage.ts`,
`omp/usage.ts`, `hermes/usage.ts`, `agy/usage.ts`); OMP, Hermes and Agy run
only through `context.executor.run()`, never branch on transport, and expose a pure
parser (`parseOmpUsage`, `parseHermesUsage`). Fixtures are in
`tests/main/unit/harnessUsageProviders.test.ts` with fake identities; no CI test calls a
real account. The parsers state the upstream assumptions they rely on in their header
comments (verified against upstream source and live output, Oct 2026).

**Codex** — the only stateful adapter: `codex app-server` over `context.sessionExecutor`
(never `executor.run()`, auth files, backend HTTP, `codex exec` or the TUI). With no session
seam it is `unsupported`. Plain `codex app-server` (stdio is the default listener) is used rather
than `--listen stdio://` because it works on every version and matches upstream's own test client;
no version gate is needed. The session runs with a 30 s timeout (the service deadline stays 45 s)
and the JSON-RPC conversation (newline-delimited, no `jsonrpc` field) lives entirely in
`codex/usage.ts`; there is no shared JSON-RPC client. Handshake: `initialize` (client info
`clanker-grid`/`Clanker Grid`/app version from main, `capabilities: null`) -> read its response
(ignoring notifications, server requests and unrelated ids, bounded to 2000 ignored messages) ->
`initialized` notification -> `account/read {refreshToken:false}` -> `account/rateLimits/read
{excludeResetCreditDetails:true}`. `supportsLunaReserve` is deliberately not sent: it lets the
backend record experiment exposure, which a passive read must not do. Account: ChatGPT continues;
`account:null` with `requiresOpenaiAuth` -> `unauthenticated` (no limit read); `apiKey`,
`amazonBedrock` or no auth required -> `unsupported`; an unknown future type is tried and is
`unsupported` if limits cannot be read. Server errors `-32600` "codex account authentication
required..." / "chatgpt authentication required..." map to `unauthenticated` / `unsupported`
(only with that code and prefix); everything else is `command-failed`; the raw server text and
stderr never leave the provider. Compatibility: if the new params draw `-32600`/`-32602` (and not
one of those auth errors) the read is retried once with `params: null` and a new id, as the Codex
TUI does; no other error, EOF, parse or transport failure retries. Data is accepted only after the
response arrives AND `closeInput()` + `wait()` return exit code 0; a non-zero exit, transport
failure, timeout, overflow or abort fails the probe, and the session is always disposed in
`finally` (the service also reaps leftovers). Normalization: `rateLimitsByLimitId` (every meter
family) is the source when non-empty, otherwise the legacy `rateLimits`, never both. Each
`primary`/`secondary` window is a `rate-limit`/`percent` measurement: used = `usedPercent`
(overage kept), remaining = max(0, 100 - used), limit 100. `windowDurationMins` is authoritative
(300 -> "5 hour", 10080 -> "weekly", otherwise N week/day/hour/min; never inferred from
primary/secondary); `resetsAt` is Unix **seconds** and is multiplied by 1000 (values >= 1e11 are
rejected as probable milliseconds rather than trusted); `period` = label, `endsAt`, and `startsAt =
endsAt - duration`. Labels are `<limitName | limitId | map key> · <duration>` ("Codex · 5 hour",
"Spark · weekly"). Scope: `providerId: "openai-codex"`; `accountId` from the response's `accountId`
(kept in main, stripped for the renderer; never derived from email, no cross-harness dedupe yet);
`accountLabel` from the ChatGPT account email; `planLabel` from the meter's `planType`, else the
account's; `modelId` from `normalModelSlug`. `observedAt` is probe completion time. Omitted on
purpose because the shared model cannot represent them safely: `ordinaryUsageAllowed`,
`spendControlReached`, `rateLimitReachedType`, `rateLimitUpsell`, reset credits, and `credits`
(repeated in every snapshot, unit unspecified, `unlimited` has no numeric form).
`individualLimit` keeps only `remainingPercent` as an `allowance` percent (its `limit`/`used`
strings have no stated currency, so no monetary measurement). Malformed meters are skipped while
valid ones survive; if any was malformed and none remains, `parse-failure`. Refresh: cache 60 s,
hard minimum 60 s, failure backoff 120 s (each probe spawns app-server, locally or over SSH).
`account/rateLimits/updated` notifications are ignored because the session is short-lived.

**Claude** — Claude Code's stream-json *control* protocol through `context.sessionExecutor`
(stateful, like Codex). The Agent SDK is deliberately not a dependency: instantiating it would spawn
a local Claude Code and bypass SSH environments, so the provider speaks the same wire protocol
inside the selected workspace environment (verified against claude 2.1.287, SDK 0.3.287 types and
transport argv, T3 Code's probe, and live runs). Argv, in the SDK's order: `claude --output-format
stream-json --verbose --input-format stream-json` (no `--print`; verified), plus the SDK's probe
isolation: `--no-session-persistence`, `--settings {"disableAllHooks":true}` (no user, project,
local or Clanker attention hooks), `--mcp-config {"mcpServers":{}}` with `--strict-mcp-config` (no
configured MCP servers), and env `ENABLE_CLAUDEAI_MCP_SERVERS=false`,
`CLAUDE_CODE_AUTO_CONNECT_IDE=0`, `CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL=1` (no connected claude.ai MCP
or IDE discovery). `--bare` is not used because it skips OAuth/keychain; auth and account selection
(`CLAUDE_CONFIG_DIR`, API keys, Bedrock/Vertex) are Claude Code's own and never touched, and no auth
file is read. **No model turn:** only two `control_request` frames are ever written — `initialize`,
then (after its response) `get_usage` with `skip_behaviors:true` (documented in the SDK types; skips
the local transcript scan) — never a `user` message or prompt. Inbound `assistant`/`user`/`result`/
`stream_event` frames (structural evidence of a turn) or any inbound `control_request` (permission,
hook or MCP asks) fail the probe, and nothing is ever granted. Unrelated frames and control responses
for other ids are ignored; a matching control error is `command-failed` (text never exposed). Live,
the whole probe takes under a second and emits only `control_response` frames. Account (from the
`initialize` response, structured fields only): `apiProvider` other than `firstParty` or an
`apiKeySource` -> `unsupported`; `tokenSource:"none"` with no email/subscription (the live-verified
signed-out shape) -> `unauthenticated`; otherwise continue (absent/ambiguous info is not claimed as
signed out and `get_usage` decides). `get_usage`: `rate_limits_available:false` (API key, Bedrock,
Vertex, missing scope) -> `unsupported`, never an empty `ok`; `true` with an object of limits proceeds;
non-boolean or missing limits -> `parse-failure`. Windows (`utilization` is already 0-100, not a
fraction like streamed `rate_limit_event`s) become `rate-limit`/`percent` rows: `five_hour` ->
"Claude · 5 hour" (300 min), `seven_day` -> "Claude · weekly" (10080 min), and the documented named
families `seven_day_oauth_apps`, `seven_day_opus` (modelId `opus`), `seven_day_sonnet` (modelId
`sonnet`) as distinct rows. `model_scoped[]` entries become weekly rows labelled by `display_name`
("Claude · weekly · Fable"); `display_name` is presentation text, so no `modelId` is invented, and a
family already reported as a named field is not duplicated. `resets_at` must be ISO with an offset
(otherwise omitted); `startsAt` is derived only for the 5-hour/weekly windows. Plan: the usage
`subscription_type` (else the init `subscriptionType`, with a leading "Claude " dropped) title-cased
(`pro`->Pro, `max`, `team`, `enterprise`, other values keep their words); email is the
`accountLabel` only — there is no stable account id, so none is invented. Deliberately not
normalized: `session` cost/model usage and `behaviors` (session/transcript data, not quota),
`extra_usage` (utilization scale unverified and money is in minor units), and the undocumented
codename windows and `limits[]` the live response also carries. The control API is explicitly
experimental, so the parser is isolated, tolerant of additive fields, skips individually malformed
windows while valid ones survive (all malformed -> `parse-failure`). As with Codex, data is returned
only after `closeInput()` + `wait()` exit 0 and the session is always disposed. Session bounds:
30 s, 512 KiB (a live probe is ~38 KB). Refresh: cache 60 s, hard minimum 60 s, failure backoff 180 s.
Streamed `rate_limit_event` updates and persistent sessions are out of scope. The adapter uses
`providerId: "anthropic"`, the quota namespace OMP also uses (see "Provider identity" below).

**Provider identity.** `scope.providerId` names the underlying quota/provider namespace, never the source
harness: source harness -> provider -> account -> measurement. Overlapping direct and aggregator
sources use the same value with no translation table: direct Codex and OMP's Codex report
`openai-codex`, direct Agy and OMP's Antigravity report `google-antigravity`, direct Claude and OMP's
Anthropic report `anthropic`. A regression test pins the verified names. No cross-harness
deduplication exists yet; this only keeps the data model consistent for later correlation.

**OMP** — `omp usage --json` (never `omp usage invalidate`; `force` only bypasses
Clanker's cache). One report per credential, so several providers and several
accounts of one provider coexist in one snapshot. Each limit with numeric data becomes
one measurement: `percent` (or fraction-only) limits -> `unit: 'percent'`,
used = `usedFraction`/`used` x 100, limit 100, remaining derived (negative fractions
clamp to 0, overage stays visible); absolute units (`tokens`, `usd`, `requests`,
`credits`, ...) keep their unit and values, deriving the missing one of
used/remaining from the limit. Kind: tokens -> `tokens`, usd -> `spend`, else
`rate-limit` when OMP supplies a window, otherwise `allowance`. Window label, duration
and reset come only from `window.*` (never from `primary`/`secondary` ids):
`resetsAt`, `period{label, endsAt, startsAt = resetsAt - durationMs}`. Scope:
`providerId` from the limit/report provider; `accountId` only from
`scope.accountId`/`metadata.accountId`; `accountLabel` from `metadata.email`;
`planLabel` only from documented plan metadata (`metadata.planType`/`plan`) — never
`scope.tier`, which also names model/quota meters such as Codex `spark`; `modelId` when present. No identity is
synthesised, and nothing is deduplicated across harnesses (the same Codex account
appears via OMP and Hermes). Copies of one quota sharing `scope.sharedGroup` within a
report are collapsed. `accountsWithoutUsage`, `disabledCredentials`, `capacity`,
`resetCredits`, `status` and unknown keys are ignored: an empty `reports` array (with or
without `accountsWithoutUsage`) is an `ok` snapshot with zero measurements, not an error
and not `unauthenticated`, because JSON mode exits 0 and cannot tell "no credentials"
from "only providers without a usage endpoint". `observedAt` is the oldest report
`fetchedAt` (OMP serves cached reports; this is the honest data age). Tolerance: a
non-object root or non-array `reports`/unparsable JSON is `parse-failure`; a
malformed report or limit is skipped so valid providers survive, unless something was
malformed and nothing valid remains (then `parse-failure`). Non-zero exit ->
`command-failed`. Refresh: cache 60 s, hard minimum 60 s, failure backoff 120 s. OMP
caches provider reports for 5 minutes and has its own failure cooldown, so a minute
cadence is cheap and does not defeat that cache; the minimum bounds process spawns.

**Hermes** — `hermes usage --json`, one invocation for the *configured* provider
(same credential resolution as a session, no agent started); no provider fan-out.
Each window with a numeric `used_percent` (0-100) becomes a `percent` measurement
(remaining = 100 - used, limit 100); `label` -> `label` and `period.label`;
`resets_at` (ISO with offset) -> `resetsAt` (kind `rate-limit`, else `allowance`);
`detail` -> `description`; `provider` -> `scope.providerId`; `plan` ->
`scope.planLabel`; `fetched_at` -> `observedAt`. Null `used_percent` windows carry no
number and are skipped. No account identity is produced because Hermes documents
none. Exit 1 (no credential, no usage endpoint and fetch failure are
indistinguishable, and stderr is deliberately not interpreted) is a generic
`command-failed`, never `unauthenticated`. Exit 0 with `unavailable_reason` set and no
measurements (free text; only its presence is used) is `unsupported` for the configured
provider. Strictness: bad root/`windows`, a window without a string label, or a
non-null `used_percent` outside 0-100 / not a number is `parse-failure`; an invalid
`resets_at`/`fetched_at` is just omitted. Refresh: cache 60 s, hard minimum 60 s,
failure backoff 300 s. Hermes makes a live provider request on every call with no cache
of its own, so it gets no faster than the popover needs; exit 1 is often a permanent
"not configured" state, so a long failure backoff avoids respawning Python every minute.

**Antigravity (`agy`)** — `agy --version`, then `agy --output-format json -p=/usage`
(the `-p=` form binds the prompt so later flags can never become the print prompt). Both go
through `context.executor.run()`; the adapter has no transport branching, cwd, env or
credential access. *Why the version check comes first:* before agy **1.1.11** `-p /usage` is
not a command and is sent to the model as a normal prompt, which would create a real
conversation and spend quota. The probe therefore runs only when the whole `--version`
output is exactly one `X.Y.Z`/`vX.Y.Z` line that is >= 1.1.11; older, prerelease
(`1.1.11-rc.1`), noisy, ambiguous or unparseable output fails closed with `unsupported` and
`/usage` is never issued. *Second guard:* a reply is accepted only when `conversation_id` is
empty, `num_turns` is 0 and every `usage.*_tokens` is 0 (absent counts as zero; anything else
is evidence a model turn ran). Otherwise it is rejected as `command-failed` (the integration is supported; this is an
unexpected safety failure) with a one-hour hard
backoff (`HarnessCapabilityError.retryAfterMs`, honored by the service even for manual refresh).
Envelope consumed: `status: "SUCCESS"`, `command.name === "usage"`,
`command.data.groups[].buckets[]`; the human `response` text is never parsed and group names
are never matched. Each enabled bucket with a numeric `remaining_fraction` becomes a
`rate-limit` / `percent` measurement: remaining = clamp(fraction, 0, 1) x 100, used =
100 - remaining, limit 100, `resetsAt` from an RFC3339 `reset_time` with explicit offset
(missing/invalid/timezone-less resets are omitted, never read as local time), label
`<group> · <bucket name>`, `period.label` from the vendor `window` (`5h` -> "5 hour",
`weekly` -> "weekly", unknown windows kept verbatim) and `startsAt` only for those two known
durations. **Disabled buckets are skipped** (the tier does not meter them, so they must not
appear as 100% left); a tier with only disabled buckets is an `ok` empty snapshot. Groups are
preserved in the label, so "Gemini Models" and "Claude and GPT models" weekly/5h buckets stay
distinct. Scope is only `providerId: "google-antigravity"` (matching OMP's provider id for
later correlation); no account, project or plan is invented, and `observedAt` is when the
probe completed. Tolerance: no envelope, a wrong command name or missing `groups` is
`parse-failure`; malformed groups/buckets are skipped while valid ones survive; if anything was
malformed and nothing usable remains, `parse-failure`. Strict JSON is tried first; otherwise
only whole-line `{...}` candidates that look like envelopes are considered, and conflicting
valid envelopes or JSON embedded in prose are rejected. Errors: a non-SUCCESS envelope is
`unauthenticated` only when its own structured `error`/`error.message`/`message`/`error_message`
text (never the human `response`) matches a narrow phrase
list (authentication required, not authenticated, login required, credentials/token
revoked, token expired); everything else, including "authentication failed or timed out",
network errors and non-zero exits without an envelope, is a generic `command-failed`. stderr is
never inspected, and raw vendor text never reaches the renderer. The error-envelope shape is
unspecified upstream, so this classification is best effort and unverified against a live
error. Refresh: cache 60 s, hard minimum 120 s (each probe is a live vendor quota request with
no local cache), failure backoff 300 s; every probe also repeats the cheap version check.

### Intentionally unsupported: OpenCode and Pi

Implemented: Codex, Claude, OMP, Hermes, Agy. OpenCode and Pi have no `usage` capability. Absence is
the canonical registry representation, not a pending task: their upstream contracts do not meet
Clanker's integration boundary (structured, non-turn, credential-owning, runnable through the
environment in local and SSH workspaces). A capability that only throws `unsupported` is never
added, and local history is never presented as an allowance.

**OpenCode** (checked against 1.18.34 and `anomalyco/opencode`). The official OpenCode Go server
endpoint `GET https://opencode.ai/zen/go/v1/usage` exists and reports rolling, weekly and monthly
windows, but it authenticates with the user's OpenCode API key (`Authorization: Bearer ...`). No CLI
command exposes it through OpenCode's own credential handling: the commands are `run`, `serve`,
`models`, `providers`, `stats`, `export`, `session`, `db` and `debug` (none returns quota; the hidden
`account` commands only manage console login). `opencode stats` is local token/cost history over
stored sessions, not server quota, and OpenCode is multi-provider, so Go quota would not describe
Zen pay-as-you-go balance or credentials for other providers configured through OpenCode. Using the
endpoint would require Clanker to read `auth.json`/environment keys and call the API itself, which it
does not do, and a Go-only adapter would make a harness-wide capability look more universal than it
is. OpenCode remains unsupported until a canonical CLI or server capability exposes quota without
credential extraction.

**Pi** (checked against 1.0.0 and the upstream coding-agent source). Pi is a multi-provider harness
(Anthropic, OpenAI/Codex, OpenRouter, Copilot, Z.ai, OpenCode Go, Kimi, ...) with no single quota
namespace and no core quota snapshot. Its CLI exposes `pi auth check --json` (readiness only: `status`,
`provider`, `authType`), `pi auth print-api-key` / `print-bearer-token` and `--credentials` (which hand
out credentials and are never used), and local session totals (`usage-totals`: tokens, context, cost),
none of which is subscription quota. Community `/usage`/`/quotas` extensions each read Pi's auth
storage and call vendor APIs themselves, which shows quota can be built on top of Pi but is not a Pi
interface; Clanker will not read Pi credential stores or rebuild that provider-credential stack. Pi
remains unsupported until core Pi exposes a structured quota interface suitable for local and SSH
execution.

IPC: `HARNESS_USAGE_GET` (`getHarnessUsage(workspaceId, { harnessIds?, force? })`)
returns `{ workspaceId, entries }` for all (or the requested) harnesses.

### Usage header control (renderer)

A **Usage** button (gauge icon and chevron, like Settings; `aria-label`/title "Usage") sits between Chat history and Settings in the header. It is
a controlled Radix Popover like its siblings: same positioning, Escape/outside dismissal, focus
restoration to the trigger, a `BrowserOverlayLease` while open, and mutual exclusion with Chat history
and Settings in every direction (the Settings-to-Credentials handoff is untouched). Switching the
focused workspace closes it and bumps an ownership generation, so late responses from the old workspace
never render and reopening queries the new workspace id (the renderer identifies the environment only
by `workspaceId`, with bounded harness-selection and refresh options). The trigger is disabled until
persisted harness preferences have loaded, so initial reads respect saved provider visibility.

Only harnesses with a verified usage capability appear in the panel. Support is canonical descriptor
metadata (`usage: { support }` in `HARNESS_DESCRIPTORS`, enforced against `provider.usage` by
`defineHarness()` typing and a registry test; `USAGE_HARNESS_IDS` is derived from it), currently Codex,
Claude, Oh My Pi, Hermes and Antigravity. OpenCode and Pi remain intentionally unsupported and are
therefore absent: never listed, requested, polled or refreshed. Each supported harness has a persisted
**Show in Usage** preference (`HarnessDefaults.usageVisible`, default true; missing or malformed legacy
values validate to true; saved through `setHarnessDefaults`) in Settings, inside the expanded harness
panel beside Agent attention and shown only for supported harnesses. It is independent of the launcher
"visible" checkbox. The panel operates only on supported harnesses that are enabled: initial open,
60 s polling, manual refresh, `refreshableAt` gating and pending state all use that list, so a hidden
provider is never queried in the background, and a late response from a newly hidden provider cannot
restore its row. With every provider disabled the control stays available and shows "No usage providers
selected" with no requests. Not-installed and other per-provider states remain visible for the enabled
providers. Reads are
**progressive**: opening issues one `getHarnessUsage(workspaceId, { harnessIds: [id] })` per harness,
concurrently, and each row updates as its own answer arrives (a slow provider shows "Checking usage…"
while others already show data). Reopening keeps previously rendered values and issues ordinary reads
immediately; main's cache decides whether to probe. The main service shares one in-flight availability
check across these concurrent per-harness calls (and still treats an empty/failed answer as
inconclusive). While open, an ordinary (non-forced) read repeats about every 60 s, skipping harnesses
already in flight, and a 30 s clock drives countdowns; both stop on close, unmount or workspace switch.
There is no background polling while closed. The Refresh button sends `force: true` per harness; main's
hard provider minimums, backoff, `retryAfterMs` and the 10 s floor stay authoritative. The renderer uses
only the returned `refreshableAt` for UX: Refresh is disabled while any selected harness request is in
flight (initial, polling, or forced), when no providers are selected, and while all resolved entries have
future refresh deadlines ("Refresh available in Ns"). A resolved entry without `refreshableAt`, such as
`not-installed`, permits a forced recheck once loading finishes; unresolved entries do not count toward
refresh eligibility. An IPC rejection never shows
raw text: it becomes "Usage could not be read", and a prior good reading is kept and flagged stale.

Rendering: percent windows show remaining first ("72% remaining", or "N% used" when only that is
known; overage is shown as the true value while the bar empties) with a progress bar of REMAINING capacity (amber at 10% or less)
(`role="progressbar"` with `aria-valuetext`); other units render as `used / limit unit`, `remaining`, etc.,
a bar only when a denominator exists, and money formatting only for the `usd` unit. Resets read "resets
in 1h 42m / 3d 6h", a short date when far away, or "reset due"; "checked ..." uses `checkedAt` (not
`observedAt`). Entries with `stale` keep their measurements, show a Stale badge and the current safe
status text; `ok` with no measurements reads "No active usage limits reported". Measurements are
grouped within a harness by display-safe provider, account label and plan (never the model); a single
group puts plan/account beside the harness name, several groups get subheaders using a presentation-only
provider display-name formatter (it never affects dispatch, correlation or caching). Only an exact
leading "<harness> · " is stripped from a harness's own labels. State lives in `useHarnessUsage`;
`UsageDropdown` is presentational and styled by `UsageDropdown.css` using existing tokens and the
low-radius system.

### Issue #55 validation and follow-up

The reviewed feature HEAD `fcba2e9a9b7f452cecc9a5746856633626798e9c` passed
`npm run validate` (branding check, lint, typecheck, security audit, build, and 229 test files / 4,847 tests).
[PR #70](https://github.com/Bynzski/clanker/pull/70) merged the feature with passing Ubuntu and Windows
validation checks. Local usage probes were live-tested. Full authenticated Codex/Claude usage over a real
SSH host remains a non-blocking smoke-test follow-up because the available host did not have those CLIs
installed/authenticated; automated transport tests are not evidence of that live authentication path.

## Preserved limitations and follow-ups

- Pi: history still scans conventional paths and first-line session headers.
  Invocation re-resolves identity from trusted storage with canonical file checks,
  honoring `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR` and stored
  `--session-dir` flags. Renderer paths are never authority. Custom-root history
  and SSH parity remain follow-ups; the provider-owned root resolver is the seam.
- OMP: this checkout assumes `~/.omp/agent/sessions` locally and over SSH. Home,
  coding-agent, profile, XDG and session-dir overrides are not integrated despite
  upstream support. The migration isolates these roots without expanding them.
- Agy: fixed SQLite schema, version-sensitive model list and no native fork.
  AI commit now uses documented JSON stdin/output, avoiding Windows shell quoting
  and argument-size limits. Native attention hooks still need real-turn smoke
  testing. Global plugin ownership is process-local: Clanker currently has no
  `requestSingleInstanceLock`. Concurrent app processes can overwrite/remove
  another process's owned plugin; address single-instance policy or ownership
  separately without introducing a lease framework here.
- OpenCode: local session-list pagination remains its CLI default; SSH explicitly
  requests the extra row to reject truncation. SQLite/legacy storage is CLI-owned.
- Hermes: local attention/history/inference remain unsupported; remote attention
  requires its default profile. Provider-qualified models and refresh behavior
  remain intact.
- Failure classification intentionally preserves raw causes when native errors
  cannot be categorized more precisely. Existing Codex malformed-model compatibility fallback
  and Pi/OpenCode permissive text parsing need separate compatibility decisions.
- Persistent SSH plugins fail closed on partial or unknown installations; recovery
  from an interrupted host setup remains a future lifecycle enhancement.

## Oh My Pi (`omp`) implementation notes

Original integration baseline: OMP 18.3.4 (September 2026),
`/home/jay/.local/bin/omp`. Issue #60 revalidation: OMP 18.4.4 (October 2026). This path and version are observations from the development machine,
not installation requirements. OMP uses a separate `omp` ID so its defaults,
attention events, and session history do not collide with Pi.

| Capability | Observed CLI or storage contract | Integration work |
| --- | --- | --- |
| Interactive launch | `omp`; `--model=<selector>` | Registered as a separate harness using the common PTY launch path. |
| Models | `omp models --json` returns a `models` array with `selector`, `name`, `kind`, and provider fields; 561 chat entries on this installation | Use `selector` as the ID and accept chat entries only. The catalog can contain models without available credentials, so selection can still fail at launch. |
| Sessions | Default profile: `~/.omp/agent/sessions/<project>/*.jsonl`; sampled file begins with `title`, then `session` (`id`, `cwd`, `timestamp`); `model_change` uses `model` | Stream metadata extraction with at most 16 files open per batch. Pi's first-line parser is incompatible. Current discovery reads only the default root. |
| Resume/fork | `omp --resume <path>` and `omp --fork <path>` | Use a saved `.jsonl` path after checking it stays inside the default OMP session store. Fork is present in the installed CLI's session resolution code even though top-level help omits it. |
| Attention | `--extension <path>` with `agent_start`, `agent_settled`, and `session_shutdown` events | The dedicated extension maps agent start to running, `agent_settled` (no retry, compaction or queued continuation left) to turn complete, and session shutdown to a session boundary. It does not report input requests. |
| AI commit | `--print --no-session --no-tools --no-extensions` | The commit pipeline pipes the prompt through stdin. OMP 18.3.4's source reads piped input as the initial prompt. No billable model request was made during verification. |

The code and tests cover registration, parsing, session invocation arguments,
attention injection, AI commit arguments, and path containment. The local CLI
reported its version and model catalog, and an invalid-session probe confirmed
that it parses `--fork`. An interactive Clanker launch, a completed resume/fork,
attention delivery from a running OMP instance, and a live AI commit response
have not been smoke tested. Profile, `--session-dir`, `PI_CODING_AGENT_DIR`,
`PI_CODING_AGENT_SESSION_DIR`, and XDG session roots are outside current history
discovery and file validation. Interactive launches can still use those OMP
options as extra flags; their sessions will not appear in Clanker's history.

For later harnesses, check the installed binary and the matching version's
source. OMP's [18.3.4 session resolution](https://github.com/can1357/oh-my-pi/blob/v18.3.4/packages/coding-agent/src/main.ts)
implements `--fork` and piped prompt input. Its [extension documentation](https://github.com/can1357/oh-my-pi/blob/main/docs/extensions.md)
distinguishes `agent_end` from Pi's `agent_settled`. Its [storage documentation](https://github.com/can1357/oh-my-pi/blob/main/docs/config-usage.md)
describes profile and XDG relocation. Verify these seams for each CLI version
before copying an existing adapter.

## Hermes (`hermes`) implementation notes

Local CLI (Linux, September 2026): `/home/jay/.local/bin/hermes`, version
`0.21.5+2453.gd0288be` (upstream `d0288be5`). `hermes --help` establishes
`hermes --tui` for interactive launch and `-m <model>` as a TUI model override. Clanker uses the common PTY wrapper,
passing `-m` before `--tui`, and retains the user's workspace as the CLI cwd.
The installed `hermes model` command is interactive, not a machine-readable
list. Clanker requests the documented `model.options` JSON-RPC inventory from
the local Hermes TUI gateway using its standard Python environment
(`~/.hermes/hermes-agent/venv`, or `HERMES_PYTHON` for the interpreter).
Normal discovery is bounded and reads Hermes's nonblocking cached catalog, which
may omit newly available subscription models. An explicit **Refresh Hermes
models** in settings or the gate requests live provider catalogs, bypasses
Clanker's one-hour cache, and is bounded to 45 seconds; failure preserves the
last usable list. The picker shows model IDs before provider names so variants
remain legible even when the menu is narrow. Neither mode makes a model call.
Provider/model selections preserve both identifiers, launching the TUI with
`-m <model> --provider <provider>`; previously saved manual IDs continue to
launch with `-m <model>`. Settings and the workspace gate use the existing
model picker and favorites; the manual field remains available if discovery
fails or the user needs a custom model.

This integration includes CLI detection, persisted defaults, visibility,
flags, provider-aware discovery, manual model overrides, and interactive launch. Hermes history,
resume/fork, local attention hooks, and AI commit remain unintegrated. SSH attention now uses the Hermes observer plugin API; see [Remote Agent Attention](workspaces.md#remote-agent-attention). The agent
attention toggle applies to SSH launches, and the workspace gate has no Hermes keyboard
shortcut. Do not use the installed CLI's `--oneshot` or `chat -q` just to
probe capability: those commands can incur model charges. Windows and macOS
launches, authenticated TUI sessions, live model calls, and exit-to-shell
behavior in Clanker's window remain unverified. On Linux, a `script`-allocated
pseudo-terminal displayed Hermes's interactive TUI without a model request;
the smoke process was stopped by a timeout rather than exiting through Clanker.

## Antigravity (`agy`) implementation notes

Review environment (September 2026): `/home/jay/.local/bin/agy`, version
`1.2.12`. Antigravity uses the `agy` ID matching its executable.

| Capability | Observed CLI or storage contract | Integration work |
| --- | --- | --- |
| Interactive launch | `agy`; `--model=<selector>` | Registered as a harness using the common PTY launch path. |
| Models | `agy models` emits spinner on stderr and clean tab-separated `<id>\t<label>` on stdout | Parse stdout lines by tab, deduplicate IDs, fallback to static Gemini list on error or timeout (8s). |
| Sessions | SQLite database at `~/.gemini/antigravity-cli/conversation_summaries.db`; table `conversation_summaries` | Integrated via Node 22/Electron 41 native `node:sqlite` in read-only mode. All workspace URIs are decoded and matched using `sessionMatchesWorkspace`; unset paths retain the global-session fallback, while malformed metadata is skipped. Resume invokes `agy --conversation <id>` with canonical UUID and model-selector validation; fork is unsupported by the CLI and runs resume. |
| Attention | Native hooks via an owned plugin at `~/.gemini/config/plugins/clanker-grid-attention/hooks.json` | The plugin is persistent and inert: it is installed or refreshed (atomically, idempotently) when an attention-enabled Antigravity terminal launches and is never removed on release, shutdown or startup, because it is shared by every Clanker process and by Antigravity sessions that outlive them. Every hook runs the plugin's own `guard.mjs`, which forwards to the launch-scoped bridge (`CLANKER_ATTENTION_COMMAND`/`CLANKER_ATTENTION_INTERPRETER`) only for Clanker Antigravity launches whose resources still exist, and otherwise prints `{}` and exits 0, so missing or broken temp resources can never block a tool. It maps `PreInvocation` (when `invocationNum == 0`) to `turn_started`, `PreToolUse` on `ask_question`, `ask_permission`, or `notify_user` to `input_requested`, matching `PostToolUse` events to `input_resolved`, `Stop` with `fullyIdle === true` for the bound root conversation to `turn_completed`, and wrapper exit to `agent_exited`. The matcher excludes all other tools so their native permission checks remain authoritative. Clanker refuses to overwrite an unowned directory. On startup it removes the historical `clanker-attention` plugin only when its payload matches the known shape exactly, its script is gone and it holds no other files. |
| AI commit | `--disable-slash-commands --input-format stream-json --output-format stream-json`, optional `--model` | Send one `user` JSON message on stdin and close it. The Agy provider extracts the single successful result response before shared normalization. Timeout: 60s. |

This integration includes CLI detection, persisted defaults, visibility,
flags, model discovery, interactive launch, session history discovery/resume,
agent attention, and AI commit message generation. The workspace gate assigns
`a` / `A` to Antigravity when visible.

## SSH attention transport

`sshAgentAttention.ts` obtains the selected provider's resources and hook/extension configuration through its remote attention capability, with a tty observer transport. `remoteAttentionTransport.ts` extracts bounded OSC frames before normal PTY buffering/rendering. `AgentAttentionBroker` accepts remote credentials only from their registered terminal, independently of the desktop loopback listener. Unsupported native events remain unknown.

Hermes uses its [observer hook contract](https://hermes-agent.nousresearch.com/docs/developer-guide/observer-hooks), including turn-scoped `pre_llm_call` / `post_llm_call` and advisory approval hooks. Its owned plugin is enabled via the native CLI, preserving other plugin configuration. OpenCode uses its [plugin events](https://opencode.ai/docs/plugins/); Claude uses its [command hook API](https://code.claude.com/docs/en/hooks). Shared Pi, OMP, Codex, and Antigravity mappings retain the contracts documented above.

Tests exercise all seven adapters with synthetic lifecycle events over real pseudo-terminals, configuration conflicts, ownership checks, and terminal credential/cleanup routing. Those checks do not make model calls or establish compatibility with every installed CLI version. Live remote agent turns remain a separate smoke check.

## Follow-up CLI contract verification (October 2026)

Installed versions checked without model prompts: Codex 0.159.3, OpenCode
1.18.34, Pi 0.87.1, OMP 18.4.4, Hermes 0.21.5 and Agy 1.2.14. Claude's shim
exists but its native optional binary is missing. Local PTY startup/resume/fork
checks and the saved SSH host checks are recorded in
[the historical follow-up report](issue-60-followup-report.md). The final
architecture and validation state is recorded in
[the final hardening report](issue-60-final-hardening-report.md).

AI commit uses Codex `exec` stdin, OpenCode `run` stdin, Pi `--print` stdin,
and the existing OMP print/no-session/no-tools/no-extensions stdin contract.
OpenCode's [v1.18.34 run source](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/opencode/src/cli/cmd/run.ts)
reads piped input; its bare executable starts a TUI. Pi's installed print-mode
help and main implementation confirm explicit print mode. OMP's
[v18.4.4 main source](https://github.com/can1357/oh-my-pi/blob/v18.4.4/packages/coding-agent/src/main.ts)
reads piped text before headless execution. Codex `exec --help` documents stdin.

Agy's [headless contract](https://www.antigravity.google/docs/cli/headless/)
supports JSON stdin with one result per prompt and exit after EOF. Installed
`--print` requires a prompt argument and rejects an empty prompt; passing plain
stdin does not satisfy that explicit print contract. JSON input avoids embedding
Git content in `cmd.exe` arguments. `agy models` and native `--print /help` were
checked without inference. Installed effort help includes `max`, while the
current web reference lists fewer values; user flags remain opaque. Conversation
resume exists; no native fork is documented or exposed. The supported manual
plugin root remains `~/.gemini/config/plugins`; no path migration was made.

Pi 0.87.1 documents `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR` and
`--session-dir` (the explicit directory wins). Default sessions sit beneath an
encoded cwd directory; explicit session directories are flat. Invocation lookup
models those layouts without expanding existing history discovery.

OMP's [v18.4.4 directory resolver](https://github.com/can1357/oh-my-pi/blob/v18.4.4/packages/utils/src/dirs.ts)
uses `PI_CODING_AGENT_DIR`, `PI_CONFIG_DIR`, `OMP_PROFILE` (with legacy
`PI_PROFILE`) and existence-dependent XDG relocation, with stricter named-profile
rules. Neither `OMP_HOME` nor `OMP_CODING_AGENT_DIR` appears in that resolver;
do not canonize those names without version-specific evidence. OMP storage
integration remains conventional locally and on SSH. Future storage work should
extend provider root specifications and keep host environment resolution on-host.

## Removed-worktree resume (issue #100)

Conversations that ran in an isolated agent's worktree appear in the workspace's chat history
(`sessionWorktrees.ts`). When the worktree has since been removed, whether a harness can continue the
conversation from another directory is a property of that CLI, recorded per provider as
`sessions.resumesWithoutOriginalDirectory`. Only a *proven* `true` lets main resume in the main checkout (with an
explicit notice); everything else resumes only in its original directory, so main offers to recreate the
worktree from its branch (`resolveSessionResumeTarget`, `RecreateCheckoutOffer`) and otherwise says precisely why
it cannot.

Characterized (October 2026) with the installed CLIs, a throwaway `HOME`/config directory and a session fixture
whose recorded cwd no longer exists, resumed from an unrelated directory. No credentials were provided, so a
resume that reaches the account/login step has already located and loaded the conversation:

| Harness (version) | Resume after the cwd was removed | Evidence | Policy |
| --- | --- | --- | --- |
| Claude 2.1.289 | Finds and continues it; stays in its own project file | `claude -p --resume <id>` appended the new prompt to the original project file | resume in main + notice |
| Codex 0.160.0 | Finds the rollout by id; runs in the current directory | `codex exec resume <id>`: rollout appended, `workdir` = current directory (an unknown id fails with "no rollout found") | resume in main + notice |
| OMP 18.4.10 | Loads the session file | `omp --resume <file>` loaded it and proceeded (Clanker always passes `filePath`; a bare id is scoped to the session dir) | resume in main + notice |
| Pi 1.0.0 | Refuses: "Stored session working directory does not exist"; by bare id from another project it asks to *fork* into the current directory | `pi --session <file>` / `--session <id>` | recreate the worktree |
| OpenCode 1.18.34 | Finds the session (an unknown id says "Session not found") but fails with an "Unexpected server error" while its directory is missing | `opencode run --session <id>` after importing a session and deleting its directory | recreate the worktree |
| Antigravity (agy) | Not characterizable offline: its conversation store is opaque and needs an authenticated account; nothing was assumed | – | recreate the worktree |

Recreation uses the same trusted route as `New isolated agent` (`createWorktreeForSession`: `gitCreateWorktree` with
`attachCheckoutContext`, SSH recovery blocking and reservations included) for an *existing* branch. It reproduces
the original directory only because Clanker's directory name is a deterministic function of the branch
(`worktreeDirectoryName`), so it is offered only when the removed path is that generated path and the branch still
exists. It happens only after the user confirms (a second `SESSION_INVOKE` with `{ recreateCheckout: true }`), and main
first re-finds the conversation in its own history. Pi's `validateLocal` is not relaxed: the recreated directory exists
again and the session-file identity and owned-store checks run unchanged.

Provenance for a *removed* worktree (it must be proven to belong to the repository; a stranger directory under
`<repo>-worktrees`, another repository or a look-alike sibling is never matched):

1. Git lists it (live, or prunable), or a registered checkout context names it.
2. Main remembered it (`worktreeProvenance`, electron-store, keyed by environment + main checkout): written from
   Git's listing and from checkouts main creates, read back after Git forgets it. This is the only record for an
   adopted sibling or a deleted branch. A worktree created and removed entirely outside main's observation, whose
   branch is also gone, cannot be attributed (nothing proves it) and is excluded rather than guessed.
3. Its directory name is `worktreeDirectoryName(branch)` for an existing local (or remembered/listed) branch of this
   repository. The name hashes the full branch name, so this also recovers the actual branch (`feature/foo`, not
   `feature-foo-<hash>`).

Reproducing a probe: copy a real session into a temporary home, change its recorded cwd to a directory that does not
exist, and run the harness's resume command from another directory with that home (`HOME`, `CODEX_HOME`,
`PI_CODING_AGENT_DIR`, `--session-dir`, `XDG_*DIR` for OpenCode). Never point a probe at a real conversation.

SSH: the host scan takes main-derived absolute scope paths (at most 64, validated on both sides) and reports a
session whose cwd no longer exists only when it lies inside a scope; the workspace root must still exist. The
per-store byte, file, directory and 512-session bounds are unchanged (a scope costs matching, not reads).

## Hermes Assistants

Hermes Assistants are an optional, disabled-by-default, local-only integration that is **independent of the ordinary Hermes harness** above. The ordinary harness remains a normal provider launching `hermes --tui` in a normal Clanker terminal; it needs no `hermes serve` and never calls into the code below.

```text
ordinary Hermes
  -> Hermes harness provider
  -> normal terminal PTY

optional Hermes Assistants
  -> AssistantSettings                       {enabled, autoStart}
  -> HermesAssistantService
     -> hermesBackend                        adopt or start `hermes serve`
     -> hermesTransport                      WebSocket + small JSON-RPC client
     -> profiles.list                        roster
     -> canonical "Bot Chat"                 session.list / create / title
     -> /api/pty                             terminal bridge
  -> Assistant destination / navigation      app-level, not a workspace
  -> Assistant surface shell
     -> Hermes TUI (primary)
     -> Browser sidecar
```

Sources checked against upstream Hermes (`0.21.5`, September 2026): the headless root bootstrap, `HERMES_BACKEND_READY port=<n>`, `profiles.list`, `session.list`/`session.create`/`session.title`, and `/api/pty`. Hermes changes quickly; re-verify before relying on these.

### Service lifecycle

- Settings persist only `enabled` and `autoStart` (both default false). A legacy `pins` config is tolerated: `enabled` is kept, pins dropped, `autoStart` false. Tokens, ports, profile homes and session content are never persisted.
- If the Hermes CLI is unavailable (the same `getAvailableHarnessOptions()` authority as the toolbar launcher), the feature is dormant and invisible: no probe, no spawn, persisted preferences kept. Availability is evaluated once per app run.
- `autoStart=false` only adopts an already-running compatible backend at `http://127.0.0.1:9119`: a bounded `GET /api/status` must look like Hermes, and the loopback token is read only from the exact `window.__HERMES_SESSION_TOKEN__="…";` assignment in a size-bounded root response. A running service that cannot be authenticated (auth-gated, no token) is reported `detected-unusable`: it is never killed and no second backend is started.
- `autoStart=true` may start `hermes serve --host 127.0.0.1 --port 0` (no shell, through the shared local launch planner) with a fresh random token supplied through `HERMES_DASHBOARD_SESSION_TOKEN`. Readiness is the exact `HERMES_BACKEND_READY port=<n>` line on stdout or stderr, bounded by time, line length and total output; `BACKEND_PORT_IN_USE`, early exit and timeouts are failures.
- Clanker owns and stops only the exact child it started (on disable and quit); an external backend is never stopped. One bounded automatic restart per crash episode.
- Failed-startup cleanup finishes (bounded termination) before a Retry can spawn again; a coalesced Retry waits on the same operation. Fast disable → re-enable is serialized behind any in-flight stop, so a newer enable is never stranded and an older enable never resurrects a newer disable.
- If only the control WebSocket drops, the service publishes offline with surfaces disconnected and keeps a live owned child; Retry reconnects to it instead of spawning another.

### Roster

`profiles.list` is authoritative: every valid named profile except the raw `default`. `ui_meta["hermes-bots"]` is optional presentation metadata (title, description, `hidden`), not eligibility, and no messaging gateway is required. Display precedence is Bot title, profile `display_name`, then a prettified slug. The renderer receives only `{id, displayName, description?}` with an opaque id; the raw slug and session identity stay main-only.

### Canonical Bot Chat

Per profile, the session titled exactly `"Bot Chat"` is the permanent chat:

1. exact `session.list {profile, title: "Bot Chat", limit, include_hidden: true}`;
2. a failed lookup, or an empty one when the last roster positively reported a canonical chat, fails closed (nothing is created);
3. only on confirmed absence: `session.create {profile, title, hidden: true, follow_profile_config: true}`, then `session.title` on the runtime id to materialize it;
4. an "already in use" title error means another writer won: re-run the lookup and adopt the winner.

No prompt or model turn is ever sent to create the chat. Clanker never passes a workspace cwd; the profile's own `terminal.cwd` applies.

### PTY

`/api/pty?profile=<slug>&resume=<id>&attach=<key>` with the loopback token (main-only). The stable attach key `clanker-assistant-<slug>` lets a reconnect or restart re-attach to the lingering Hermes TUI instead of stacking another. Hermes allows one live viewer per attach key: a newer viewer (for example a second Clanker process) supersedes the old one (close code `4409`). Clanker never auto-loops on a PTY disconnect; the surface offers an explicit Reconnect, and re-attaches once only when the control service itself recovers. Resize uses Hermes' `ESC[RESIZE:<cols>;<rows>]` framing. Hermes keeps a detached chat process for a while after a viewer closes.

### Destinations, surfaces and Browser

Workspace and Assistant are peer app destinations with different capabilities (`lib/activeDestination.ts`). An Assistant is not a WorkspaceTab, CheckoutContext, filesystem scope or Git scope, and toolbar controls follow the active destination's capabilities (Browser and Settings only for an Assistant) instead of acting on a parked workspace. The surface shell has a primary slot (today the Hermes TUI, replaceable later by a native Assistant UI without changing service/session ownership) and an optional sidecar (today only Browser). The Assistant Browser reuses the shared Browser mechanics under its own owner `assistant-browser:<assistantId>`, which main validates against the service roster (local persistent partition; never an SSH workspace's), with its UI state in a renderer-only store. Annotation handoff and SSH remote preview are workspace-only features. Disabling Assistants disposes the Assistant-owned views and clears their UI state.

**Launcher/shell seam (no workspace required).** `App` shows the fullscreen launcher only when there are no workspaces *and* no active Assistant (`workspaces.length === 0 && activeAssistantId === null`, read reactively from `assistantNavStore`); an active Assistant is enough to enter the normal shell. `WorkspaceHost` mounts the Assistant surfaces and `BrowserLifecycleCoordinator` for an empty workspace list and synthesizes no workspace, checkout context or terminal. The launcher reuses `AssistantsRoster` (`variant="launcher"`, same `assistantsStore` snapshot, statuses and Retry; only the live roster is launchable and it is disabled while the launcher's own `opening` state is set), and appears only in the fullscreen launcher, never in the New Workspace modal. The collapsed rail hides Show Files unless a Workspace is the active destination, and Tabs mode keeps its `+` with zero tabs. Opening a workspace while Fred is active keeps Fred parked (`addWorkspace` clears only the active Assistant, after registration succeeded); transient offline keeps the shell, and only deliberate disable/unavailable teardown can return the app to the launcher.

### Known V1 limitations

No SSH Assistants; no profile creation/editing; a second Clanker process can supersede the first's viewer; no live Windows validation.

### Hardening notes (review of the after-turn work)

- **Exit is proven, not assumed.** A terminal record owns an `exited` promise settled by node-pty's own `onExit`.
  `retireTerminalAndWait` revokes authority and removes the record exactly as `retireTerminal` does, then waits
  (graceful kill, then SIGKILL, bounded) for that event; `absent`/`timeout`/`unverifiable` all stop an `after-turn` move
  before anything is resumed (nothing moved, relocated, removed or deleted; the user is told). A failed replacement is
  discarded the same way, and if it cannot be proven dead no recovery resume is attempted (a new process could silently
  attach to the live one and keep its directory). Ordinary close/kill is unchanged.
- **A cancelled create schedules nothing.** After the awaited worktree creation, and again as the last gate before a move
  is scheduled, the request's abort signal is re-checked. A checkout already created is kept attached and listed, the user
  is told it was kept and the conversation not moved (never "nothing changed"), and the tool result says the same.
- **OpenCode relocation uses the canonical launch plan** (`planLocalLaunch`: user CLI bin directories on PATH, Windows
  PATH/PATHEXT with the escaped `.cmd` form, attention credentials stripped). The call succeeds only after the server's
  own `exit` event: POSIX SIGTERM, then SIGKILL; Windows awaited `taskkill /PID n /T`, then `/T /F` (the tree, since a
  `.cmd` shim runs the server under `cmd.exe`); each phase bounded. If exit cannot be proven the call rejects with
  `UnverifiedProcessExitError`, the lifecycle treats the move as failed and resumes nothing, not even the recovery.
