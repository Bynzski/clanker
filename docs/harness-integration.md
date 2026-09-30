# Harness integration playbook

Clanker treats a harness as an installed CLI running in a PTY. A new ID has to
cross the shared type and settings boundary, appear in the renderer catalog, and
have a main-process launch definition. Model discovery, chat history, agent
attention, and AI commit are separate capabilities. Check each explicitly.

Start with interactive launch, then add only capabilities the CLI can support.
An integration is complete when the chosen capabilities pass their checks below
and unsupported ones are recorded. Do not copy another harness's session parser,
resume flags, or hook events without verifying the new CLI's contract.

## Current path through the app

1. `src/shared/harnessIds.ts` lists accepted IDs. `src/main/main.ts` creates
   default settings, and `src/main/harnessDefaultsValidation.ts` fills missing
   entries and removes unknown IDs. `src/shared/types/store.ts` defines defaults.
2. `src/main/harnessCatalog.ts` defines the command, model flag, environment,
   installed-command detection, and model discovery. The renderer obtains
   availability and models through `src/main/ipc/settingsIpc.ts` and preload.
3. `src/renderer/lib/harnessOptions.ts` supplies labels and icons to the header,
   workspace gate, terminal, settings, annotation handoff, and chat history.
   Settings visibility filters the launch surfaces, but not chat history.
   `src/renderer/components/ChatHistoryDropdown.tsx` takes its group order from
   the same catalog.
4. `src/main/ipc/terminalIpc.ts` reads the selected/default model and flags,
   builds arguments through `src/main/harnessLaunch.ts`, and launches a PTY.
   The POSIX wrapper returns to a shell on exit; Windows resolves CLI shims
   through `cmd.exe /c`. Keep path and environment behavior consistent.
5. `src/main/sessionHistory.ts` discovers and caches sessions, maps them to
   `HarnessSession`, and builds resume/fork commands. `src/main/ipc/sessionIpc.ts`
   validates the workspace path and launches the selected session.
6. `src/main/agentAttentionAdapters.ts` optionally injects hooks. The broker
   receives lifecycle events, but a harness without an adapter remains in the
   unknown state when attention is enabled.
7. AI commit is independently allowlisted in `src/shared/types/store.ts`,
   `src/renderer/lib/harnessOptions.ts`, `src/main/aiCommit.ts`, and
   `src/main/ipc/aiCommitIpc.ts`. A CLI needs a tested noninteractive invocation
   and output format before it belongs in this list.

## Implementation path

1. Write down the CLI contract first: executable and tested version, install
   location on each available OS, interactive/model/list/resume/fork/print
   commands, session storage roots and format, hook events, and commands that
   can incur model charges. Use the installed CLI's help and matching version's
   docs or source. Mark untested platforms and capabilities explicitly.
2. Add the stable ID to `src/shared/harnessIds.ts`, the command and model flag
   to `src/main/harnessCatalog.ts`, and the label and SVG icon to
   `src/renderer/lib/harnessOptions.ts`. The generic defaults migration uses
   `KNOWN_HARNESS_IDS`; confirm `src/main/main.ts` and
   `src/main/harnessDefaultsValidation.ts` need no special case. This is the
   minimum interactive launch integration.
3. Add each supported optional capability using the file map below. For a
   session that resumes by file path, validate the renderer-supplied path in
   `src/main/ipc/sessionIpc.ts` before passing it to the CLI. Use
   `resolveExistingFileWithinDirectory()` from `src/main/security.ts`, restrict
   the expected file format, and resolve symlinks. Add the harness's branch to
   `buildSessionInvokeArgs()` in `src/main/sessionHistory.ts`; its default
   branch currently launches Claude and must not receive a new ID.
4. Update the focused tests and user docs, then run the validation commands.
   If a live model call or a supported OS cannot be tested, leave that gap in
   the harness-specific notes instead of treating unit tests as a smoke test.

| Capability | Edit points | Verification |
| --- | --- | --- |
| Interactive launch and settings | `src/shared/harnessIds.ts`, `src/main/harnessCatalog.ts`, `src/renderer/lib/harnessOptions.ts`; inspect `src/main/ipc/terminalIpc.ts` and `src/main/harnessLaunch.ts` | Detection and defaults tests; launch from workspace gate and header with working directory, model, flags, and exit-to-shell behavior; check packaged app PATH and Windows shim where available. |
| Model picker | `src/main/harnessCatalog.ts`, possibly `src/main/modelCache.ts` | Parser fixtures for valid, empty, malformed, and duplicate output; timeout/error/cache behavior; verify displayed selector is accepted by the CLI. |
| Chat history | `src/shared/types/session.ts`, `src/main/sessionHistory.ts`, `src/main/ipc/sessionIpc.ts`, possibly `src/main/security.ts` | Missing/corrupt files, workspace filtering, large history, POSIX IPC paths, resume/fork arguments, outside-root and symlink rejection; live resume/fork if safe. |
| Agent attention | `src/main/agentAttentionAdapters.ts`, `src/main/agentAttentionBroker.ts` if a new event mapping is needed | Adapter injection and event mapping tests; a live turn and shutdown; document events the CLI cannot report. |
| AI commit | `src/shared/types/store.ts`, `src/renderer/lib/harnessOptions.ts`, `src/main/aiCommit.ts`, `src/main/ipc/aiCommitIpc.ts` | Model flag, prompt transport, exit/timeout/error, output cleanup, and Windows command resolution; live response only with approved model use. |

Before finishing, search for ID-specific branches (`rg -n "'codex'|'claude'|'opencode'|'pi'|'omp'" src`) and decide whether each applies to the new harness. Pay particular attention to the workspace gate's keyboard shortcuts in `src/renderer/components/WorkspaceGateContent.tsx`: they are explicit per harness, so either assign a nonconflicting shortcut or document that the new harness has none. The test API mocks in `tests/setup/electron.ts` and SVG mocks in `tests/setup/renderer.tsx` may need the new ID or icon.

## Checklist for every new harness

1. **Confirm the local CLI contract.** Record executable name, version,
   interactive invocation, model selector syntax, machine-readable model list,
   session location and format, resume/fork behavior, noninteractive mode, and
   optional lifecycle hooks. Test on each supported platform or record what
   remains unverified. Never run a prompt just to probe support if it can incur
   API usage or modify a workspace.
2. **Register the identity and defaults.** Add one stable lowercase ID to
   `KNOWN_HARNESS_IDS`; add a main catalog entry and renderer label/icon. Check
   that existing persisted settings gain a default entry and unknown IDs still
   get removed. Avoid renaming an ID after users have saved settings/sessions.
3. **Check launch and detection.** Confirm the command is found in the desktop
   app's PATH and spawns in a PTY in the requested working directory. Verify
   model/flags argument order and fallback shell behavior on POSIX and Windows.
   Keep any harness-specific environment settings scoped to that launch. A
   noninteractive command needs the same Windows shim resolution and desktop
   PATH handling as the interactive PTY path.
4. **Add model discovery if available.** Use bounded time and output, parse the
   CLI's machine-readable format, deduplicate stable model IDs, and provide an
   empty or intentional fallback. Distinguish a valid empty catalog from
   malformed output before caching it. Decide whether the CLI lists usable
   models or its entire catalog before presenting them as choices.
5. **Add session discovery and invocation if supported.** Parse only required
   metadata; tolerate missing/corrupt files; filter by workspace with
   `sessionMatchesWorkspace`; convert paths at IPC boundaries. Validate any
   renderer-supplied session file path against its session store before launch,
   resolving symlinks. Check profile, environment, XDG, and explicit session
   directory overrides before assuming a single storage root. Bound concurrent
   file reads for large histories. Add resume and fork commands only where
   their behavior is established. Do not route a new ID through another
   harness's default switch case.
6. **Decide on attention.** If the CLI has a compatible extension or hook API,
   add an isolated adapter with `turn_started`, `turn_completed`,
   `input_requested`, `input_resolved`, and `session_ended` where supported.
   Avoid replacing user hook configuration. If there is no adapter, keep the
   attention toggle unavailable or document its unknown state.
7. **Decide on AI commit separately.** Test model selection, stdin/argument
   prompt delivery, noninteractive exit, timeout, and output normalization.
   Only then add the provider to the shared type, renderer allowlist, command
   table, and tests. AI commit is not implied by interactive launch support.
8. **Cover and document the behavior.** Update catalog, launch, defaults,
   renderer, session, attention, and AI commit tests for the capabilities added.
   Update `docs/terminals.md`, `docs/configuration.md`, the test API mock
   in `tests/setup/electron.ts`, and SVG mocks in `tests/setup/renderer.tsx`
   as applicable. Run `npm run lint`,
   `npm run typecheck`, and `npm run build`; finish with `npm run validate`.

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
