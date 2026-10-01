# Harness integration playbook

Clanker requests harness operations through the canonical main-process provider
registry in `src/main/harnesses/registry.ts`. CLI differences belong to providers;
PTYs, Windows command resolution, shells, caching, workspace security, SSH
execution and batching remain shared. The issue #60 migration preserves existing
UI controls, icons, ordering, workflows and CLI behavior.

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
const invocation = provider.sessions?.resume?.build(session, flags);
```

Providers expose specifications as well as methods: a native CLI invocation and a
host Python scan are different mechanisms. Do not add no-op capabilities or
require every implementation to use one storage format.

## Current capabilities

All seven providers support local and SSH interactive launch. Model discovery and
AI commit remain local-only. No provider implements usage yet.

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
follow-up. A detailed result can therefore contain a failure even when its legacy
`discovered` cacheability flag is true.

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
const prepared = provider.attention?.local?.prepare(context);
try {
  // Shared launch engine applies prepared args/env and creates the PTY.
} catch (error) {
  prepared?.dispose();
  throw error;
}
// Dispose again on terminal exit; successful disposal is idempotent.
```

Launch IPC disposes leases on preparation/registration failure, setup or PTY
failure, and terminal exit. Cleanup failures are logged without masking launch
errors or preventing broker retirement; failed disposal remains retryable.
Agy's owned plugin retains reference counting and ownership checks. Each
preparation gets a distinct lease, including repeated preparations for one
terminal, so out-of-order disposal cannot retire another user's plugin. Unknown
files remain untouched. Shared adapter temp-file creation rolls back partial
writes. The app shutdown path retains the global adapter cleanup.

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
runtime requirements, owned plugin payloads and optional plugin-enable commands.
SSH owns secure directory installation, locking, temporary files, fresh
terminal-scoped credentials, OSC transport and cleanup. Persistent owned Agy and
Hermes observer plugins remain inert without launch credentials; per-launch
files are cleaned without recursively deleting host data. Concurrent cleanup
requests coalesce; subsequent cleanup can retry after unknown files are removed.

Intentional transport differences remain: remote scans are recursive and bounded;
local scans keep their existing formats/limits/fallbacks. Both Pi and OMP currently
use conventional session roots; neither local implementation in this checkout
resolves storage overrides. SSH Agy requires canonical workspace evidence and
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
   checks. `harnessArchitecture.test.ts` guards shared feature orchestrators
   against new harness-ID dispatch; identity comparisons and provider code remain
   allowed. Run focused tests, typecheck and lint; finish with `npm run validate`.

For a future capability, extend `HarnessProvider` and implement it under the
relevant provider. Do not add a new central harness switch/support allowlist.
`usage` is already an optional extension point with timestamped measurements,
units, allowance/rate/token/spend kinds, periods, resets and account/provider/model
scopes. There are no speculative quota probes or usage UI. Existing AI commit
owns only stdin invocation metadata; a future general noninteractive inference
capability can reuse its shared executor while Git prompt construction stays in
Git orchestration.

## Preserved limitations and follow-ups

- Pi: conventional paths and first-line session headers; configurable agent and
  session directories remain undiscovered. Local resume file validation is also
  weaker than OMP's current check; address that in a dedicated security change.
- OMP: this checkout assumes `~/.omp/agent/sessions` locally and over SSH. Home,
  coding-agent, profile, XDG and session-dir overrides are not integrated despite
  upstream support. The migration isolates these roots without expanding them.
- Agy: fixed SQLite schema, version-sensitive model list, no native fork, existing
  piped AI commit invocation and native hooks. Do not imply native fork or add
  reasoning/headless compatibility guesses. Audit upstream contracts separately.
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

Review environment (September 2026): `/home/jay/.local/bin/omp`, version
`18.3.4`. This path and version are observations from the development machine,
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
| AI commit | Piped stdin with `--disable-slash-commands`, `--model <selector>` | Integrated. Noninteractive piped invocation delivers the commit prompt via stdin, outputs the generated commit message, and is normalized by `normalizeCommitMessageOutput`. Timeout: 60s. |

This integration includes CLI detection, persisted defaults, visibility,
flags, model discovery, interactive launch, session history discovery/resume,
agent attention, and AI commit message generation. The workspace gate assigns
`a` / `A` to Antigravity when visible.

## SSH attention transport

`sshAgentAttention.ts` reuses the hook/extension event mappings from `agentAttentionAdapters.ts` with a tty observer transport. `remoteAttentionTransport.ts` extracts bounded OSC frames before normal PTY buffering/rendering. `AgentAttentionBroker` accepts remote credentials only from their registered terminal, independently of the desktop loopback listener. Unsupported native events remain unknown.

Hermes uses its [observer hook contract](https://hermes-agent.nousresearch.com/docs/developer-guide/observer-hooks), including turn-scoped `pre_llm_call` / `post_llm_call` and advisory approval hooks. Its owned plugin is enabled via the native CLI, preserving other plugin configuration. OpenCode uses its [plugin events](https://opencode.ai/docs/plugins/); Claude uses its [command hook API](https://code.claude.com/docs/en/hooks). Shared Pi, OMP, Codex, and Antigravity mappings retain the contracts documented above.

Tests exercise all seven adapters with synthetic lifecycle events over real pseudo-terminals, configuration conflicts, ownership checks, and terminal credential/cleanup routing. Those checks do not make model calls or establish compatibility with every installed CLI version. Live remote agent turns remain a separate smoke check.
