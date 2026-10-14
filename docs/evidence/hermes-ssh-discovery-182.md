# Issue #182 — Phase 1: SSH Assistant discovery investigation

## Outcome: blocked on a read-only, service-independent upstream contract

No SSH inventory is shipped in this change. Production code, local roster/details,
settings availability, Assistant IDs and remote terminal launches are unchanged.
This is the issue's explicit blocker path, not completion of remote visibility.
Clanker discovers and presents assistants; Hermes owns and runs them.

Hermes has machine-readable **service/runtime** profile APIs, but the inspected
revision has no supported one-shot **read-only inventory** command. Parsing its
human table, importing internal Python functions, starting a full TUI backend, or
managing a remote service would trade this small feature for a brittle or materially
deeper integration. None was added.

## Evidence and compatibility

Inspected upstream `NousResearch/hermes-agent` HEAD at commit
[`0e427d788d253630d38a3a51cd76849e73cd6925`](https://github.com/NousResearch/hermes-agent/commit/0e427d788d253630d38a3a51cd76849e73cd6925)
(commit timestamp `2026-10-13T23:37:47-07:00`). All upstream links below are pinned
to that revision. This is a source compatibility finding, **not** a claim about
all releases or the installed local/remote versions. `pyproject.toml` reports
`0.0.0`; no minimum supported release can be established from that value.
Recheck the native interface before implementing against a future release.

| Mechanism investigated | Verified contract / limitations | Phase 1 decision |
| --- | --- | --- |
| [`hermes profile list` parser](https://github.com/NousResearch/hermes-agent/blob/0e427d788d253630d38a3a51cd76849e73cd6925/hermes_cli/subcommands/profile.py#L8-L15), [reference](https://github.com/NousResearch/hermes-agent/blob/0e427d788d253630d38a3a51cd76849e73cd6925/website/docs/reference/profile-commands.md#L33-L51) | List subparser has no output options; documentation says “No options.” Parser-only execution accepts `profile list` and rejects `profile list --json` with exit 2. | No human-table parser. |
| [`_profile_list`](https://github.com/NousResearch/hermes-agent/blob/0e427d788d253630d38a3a51cd76849e73cd6925/hermes_cli/profile_cmd.py#L108-L148) | Prints headings, Unicode markers, formatted display-name/canonical-ID labels, truncated model/distribution text and credential-sharing warnings. Calls full `list_profiles()`, then checks shared channel credentials. | Not a stable or minimal wire protocol. Do not send its output to the renderer. |
| [`profiles.list`](https://github.com/NousResearch/hermes-agent/blob/0e427d788d253630d38a3a51cd76849e73cd6925/tui_gateway/methods_profiles.py#L281-L306) | JSON-RPC returns `{profiles:[...], bot_mode_protocol, install_id}`. Rows include canonical `name`, `is_default`, display name/description, path, model/provider, skill count, previous names, UI metadata/revisions and avatar existence. `include_sessions:false` omits session fields, not runtime startup. | Existing local roster authority. Does not itself supply a safe remote executable. |
| [`GET /api/profiles`](https://github.com/NousResearch/hermes-agent/blob/0e427d788d253630d38a3a51cd76849e73cd6925/hermes_cli/web_routers/profiles.py#L794-L808) | Structured HTTP response from an already-running authenticated backend; not identical to RPC, and has a fallback directory scan on errors. | Possible separately reviewed existing-service adapter; not inventory on an independently installed, non-running Hermes. No server start, forwarding or remote token discovery added. |
| [Documented TUI JSON-RPC over stdio](https://github.com/NousResearch/hermes-agent/blob/0e427d788d253630d38a3a51cd76849e73cd6925/website/docs/developer-guide/programmatic-integration.md#L37-L60), [`python -m tui_gateway.entry`](https://github.com/NousResearch/hermes-agent/blob/0e427d788d253630d38a3a51cd76849e73cd6925/ui-tui/src/gatewayClient.ts#L455) | Real machine-readable protocol, usable by custom hosts. However [`entry.main()`](https://github.com/NousResearch/hermes-agent/blob/0e427d788d253630d38a3a51cd76849e73cd6925/tui_gateway/entry.py#L270-L332) installs an injector, begins process metrics, registers a backend heartbeat, schedules an orphan sweep, starts configured MCP discovery, watches skins and prewarms model metadata **before reading requests**. | A transient runtime is still not a read-only profile probe. A timeout/EOF cannot undo startup side effects or guarantee cleanup of remote grandchildren. Do not launch it for inventory. |
| [`list_profile_names()`](https://github.com/NousResearch/hermes-agent/blob/0e427d788d253630d38a3a51cd76849e73cd6925/hermes_cli/profiles.py#L475-L503) | Cheap name-only internal Python helper; default plus live named directories, no per-profile config reads. Suppresses `OSError`, which can make permission failures resemble an empty catalog. Not a documented standalone CLI/serialized API. | Useful upstream implementation seam, not a production Clanker protocol. No import-path/venv/shebang inference or monkeypatching. |
| Direct directory scan | Hermes owns custom/default root resolution, valid IDs, identity markers and deletion/tombstone semantics. A bare directory is explicitly not a profile. | Would duplicate moving Hermes internals and potentially misreport deleted profiles; rejected. |

The stdio startup concern is observable in source, not hypothetical: the
[heartbeat refresher](https://github.com/NousResearch/hermes-agent/blob/0e427d788d253630d38a3a51cd76849e73cd6925/tui_gateway/session_reaper.py#L462-L534)
writes a DB heartbeat synchronously even if its refresh interval is disabled;
its startup sweep may act on stored orphan sessions. Configured MCP discovery
can connect to or start user-configured servers. No runtime was launched to
“test” these effects against the user's profiles.

### Reproducing the CLI compatibility check without running Hermes

Clone the pinned upstream revision into a temporary directory. Load **only**
`hermes_cli/subcommands/profile.py` via Python's `importlib.util.spec_from_file_location`,
create `argparse.ArgumentParser`, and call
`build_profile_parser(parser.add_subparsers(), cmd_profile=lambda _: None)`.
`parse_args(['profile','list'])` succeeds;
`parse_args(['profile','list','--json'])` raises `SystemExit(2)` with
`unrecognized arguments: --json`. This check was executed successfully. It loads
no Hermes runtime, user config, credentials or service; it is parser verification,
not a live installed-Hermes smoke test.

## Current Clanker architecture (this worktree)

- `src/main/assistants/hermesAssistantService.ts` owns optional **local** backend
  discovery/adoption, `hermes serve` startup, authenticated RPC, roster and chat
  sockets. Its `profiles.list` result enumerates all valid named profiles except
  raw `default`, including Hermes-hidden entries in the complete Settings catalog.
  Optional `ui_meta['hermes-bots']` affects presentation, not eligibility.
- `src/main/assistants/hermesDiscovery.ts` is **local service rendezvous discovery**,
  not profile or SSH discovery. Private owner records nominate loopback endpoints;
  token fingerprints, process incarnation and authenticated identity verify them.
  Legacy 9119 fallback remains. Backend credentials stay in main.
- Local canonical IDs are `hermes:<slug>`. Main retains the slug and canonical
  session separately from title/display name. Settings refreshes the complete
  catalog, offers Clanker-only hiding, and reads selected profile/history/cron
  details through the connected local service. Chat resolution is lazy; listing
  does not create Bot Chat. Details are not scheduler-liveness evidence.
- Local CLI availability is evaluated once per service lifetime. Without it,
  preferences are preserved but the service is dormant and Assistants Settings
  is hidden (`AssistantsSettings`, `SettingsManagement`). A remote Hermes install
  does not satisfy that gate today. Globally flipping `available` would wrongly
  advertise local service/surface capability; it is not the fix.
- Ordinary SSH Hermes uses `SshEnvironment`'s remote harness availability and
  terminal launch pipeline. It runs on the configured target and has its own
  attention adapter; it never populates the local Assistant service catalog.
- `EnvironmentManager` resolves only saved environment IDs to `SshEnvironment`
  and tracks invalidation generations. `executeHarnessCommand` delegates to
  `executeSshHarnessCommand`, with remote CLI PATH setup and POSIX quoting, then
  `SshCommandExecutor`: system OpenSSH, batch mode, normal host-key verification,
  bounded output/time, abort, TERM/KILL escalation and awaited client close.
  There is no need for a new SSH transport, workspace or daemon to run a future
  native one-shot inventory command. Killing the desktop SSH client alone is
  **not** proof that arbitrary remote child trees were cleaned up.

## Safest prerequisite and follow-up (approval requested, not implemented)

**Recommended:** request a small upstream native one-shot JSON inventory command,
for example `hermes profile list --json --names-only` (proposed spelling, **not an
existing command**). It should emit a versioned, bounded envelope containing
canonical named-profile IDs, distinguish permission/errors from a genuinely
empty list, and terminate without a gateway, MCP, model calls, sessions, scheduler
work, config mutation or dependency installation/update. Reuse Hermes' own live
profile identity/root logic. Do not serialize `ProfileInfo` wholesale (paths and
other unnecessary private fields). A capability/schema probe, not a version
string alone, should determine support. No new remote helper/install requirement.

Once that is available, the smallest Clanker follow-up is Settings-only inventory:

1. Resolve a saved SSH environment in main; use its own remote availability and
   bounded command executor, independently of the local CLI/service. No arbitrary
   renderer-selected command, target, home or workspace cwd.
2. Keep the local service and launchable roster untouched. Add a separate
   display-safe inventory projection with `environmentId`, canonical `profileId`,
   opaque main-derived ID, source label and **discovered / not chat-capable** state.
   Identity is `(environmentId, canonical profile ID)`, not hostname text or title.
   Two hosts with `fred` and local `hermes:fred` must remain independent. Equivalent
   saved aliases can share probe work but retain source association; edits/deletion
   invalidate it. Never authorize a local service call from this remote projection.
3. Reuse the existing Settings profile selector/list conventions with explicit
   environment/source labels. Show the page when either local capability or saved
   SSH discovery is relevant; keep enable/autostart controls **local-only**. No
   remote “Connected”, Bot Chat button, activity or cron status. Only canonical
   names are required for this phase; cosmetic metadata is deferred.
4. Coalesce/cache bounded work per environment **and generation**, use limited
   concurrency and retry backoff, and make refresh explicit rather than probing
   on every renderer render or scanning every target at startup. Abort/drain on
   invalidation/shutdown; discard late responses after edit/delete/switch. Proposed
   bounds: 12 seconds, 64 KiB, 64 named profiles, 60-second cache/backoff. Reject
   malformed, duplicate/conflicting or oversized results, never silently truncate
   them or turn an SSH/permission/unsupported error into an empty-success catalog.

Alternative requiring separate approval: read an **already-running**, explicitly
configured remote backend through a transient SSH-local authenticated request,
projecting names on the host and keeping credentials there. This needs remote
endpoint/authentication/identity policy and only covers running services; it is
not a reason to add port forwarding, auto-start `hermes serve`, or remote chat.
An internal Python-import adapter would instead require an explicit source/API
compatibility policy and runtime-resolution maintenance; not recommended here.

No generic assistant orchestration layer, future-facing IPC, source-ID migration
or unused discovery scaffolding was added just to prepare for either option.

## Verification and limitations

Added fixture-based local-boundary regressions in
`tests/main/unit/hermesAssistantService.test.ts` (kept with the established service
fixture to avoid duplicating its lifecycle setup; the suite is now 806 lines):

- Connected external-backend refresh sends only `profiles.list`, never chat
  creation, cron reads, PTY attachment or owned-service spawn.
- Two illustrative source-qualified SSH handles sharing local slug `fred` cannot
  resolve to local Fred, read his details/runs or open/write/resize his chat.
  These are rejection tests, **not** a remote ID scheme or collision solution.
- Human-table/malformed inventory clears the connected catalog and reports offline;
  a valid retry recovers without opening a chat.

Focused command (six suites):

```sh
npm run test -- tests/main/unit/hermesAssistantService.test.ts tests/main/unit/hermesDiscovery.test.ts tests/main/unit/harnessCommandExecution.test.ts tests/main/unit/sshCommandExecutor.test.ts tests/renderer/unit/Assistants.test.tsx tests/renderer/unit/AssistantProfileDetail.test.tsx
```

Result: **6 suites / 160 tests passed**. Existing coverage verifies local missing-CLI
dormancy, roster coalescing/stale-generation rejection, local details/visibility,
SSH bounded delegation, typed timeout/disconnect/abort failures and client cleanup.
Final repository check: **`npm run validate` passed** — branding, lint, typecheck,
Fallow identity baselines, security gate, renderer/shared/main build and all
**404 suites / 7,868 tests**. The security gate used only the already-documented
dev-only `GHSA-ch52-4w7c-c8xp` exception; no other high/critical findings. Build
chunk-size and Node experimental-localStorage notices were non-failing warnings.

No authorized saved SSH target was supplied or identified for this session; no SSH
connection was attempted. No live remote profiles, installed remote version,
SSH outage/recovery or native remote runtime cleanup was tested. No persistent
remote process, installation, forwarding, prompt, cron execution or profile
mutation occurred. The requested multiple-remote-profile/host, local-unavailable
remote inventory, environment-switch and remote capability presentation scenarios
remain **unimplemented and unverified**, not passed by these local fixtures.

## Deferred phases

- Remote Settings inventory after the upstream discovery prerequisite.
- Native avatars, titles/taglines, safe metadata projection and optional narrowly
  reviewed cosmetic edits (canonical identity must not change).
- Cron visibility audit, including default-profile coverage, paused/empty/error/
  unsupported cases and an explicit scheduler-health signal. Existing local
  routines remain unchanged; discovery alone proves nothing about remote cron.
- Remote chat/auth/service ownership requires separate architecture approval and
  remains outside these phases. Profile/config/SOUL/memory/model/skill/MCP/credential
  management and scheduler mutations remain out of scope.
