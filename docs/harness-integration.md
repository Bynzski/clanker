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

All seven providers support local and SSH interactive launch. Model discovery and
AI commit remain local-only. Only Codex, Claude, OMP, Hermes and Agy implement `usage` so far (see
"Usage capability"); OpenCode and Pi remain without it.

| Provider | Local models | Local / SSH history + resume | Local fork | SSH fork | Local / SSH attention | AI commit |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | debug models | JSONL / JSONL | native | native | notify / notify | yes |
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
The common launcher retains the POSIX wrapper, fallback shell, Windows
`cmd.exe /c` resolution, cwd and PTY behavior.

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
cleanup, including Agy plugin retirement. The app removes the shared root afterward.

Native hook payload normalization for Codex/Claude/Agy and credential transport
are shared. Pi, OMP and OpenCode contribute their extension/plugin sources from
providers. Do not confuse installed adapter source files with supported native
events: Pi uses `agent_settled`, OMP uses `agent_end`, and Hermes has only its
current SSH observer support.

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
emulated fork. SSH models/inference and local Hermes attention remain absent.

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
credentials. It does not reuse the interactive launcher's `cmd.exe /c` wrapper:
`environment/boundedSpawn.ts` plans the launch. POSIX runs the command directly.
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
returns `{ workspaceId, entries }` for all (or the requested) harnesses. The header
UI is not built yet.

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
| Attention | `--extension <path>` with `agent_start`, `agent_end`, and `session_shutdown` events | The dedicated extension maps the agent loop start/end and session shutdown to Clanker's running, turn complete, and ended statuses. It does not report input requests or guarantee all background work has settled. |
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
`0.21.5+2453.gd0288be` (upstream `d0288be5`). `hermes --help` and
`hermes chat --help` establish `hermes --tui` for interactive launch and
`-m <model>` as a TUI model override. Clanker uses the common PTY wrapper,
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
| Attention | Native hooks via an owned plugin at `~/.gemini/config/plugins/clanker-grid-attention/hooks.json` | The plugin exists only while an attention-enabled Antigravity terminal is active. It maps `PreInvocation` (when `invocationNum == 0`) to `turn_started`, `PreToolUse` on `ask_question`, `ask_permission`, or `notify_user` to `input_requested`, matching `PostToolUse` events to `input_resolved`, `Stop` to `turn_completed`, and wrapper exit to `session_ended`. The matcher excludes all other tools so their native permission checks remain authoritative. Clanker refuses to overwrite an unowned directory and removes only files carrying its ownership marker. |
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
