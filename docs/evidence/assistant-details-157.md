# Issue #157 — read-only Assistant detail evidence

## Scope and contracts

Implemented phases 1–2 only, in the existing Settings → Agents & AI → Assistants destination. No profile edits, model confirmation, Bot Mode changes, schedule mutations, routine execution or new attention authority.

Verified installed Hermes source: `NousResearch/hermes-agent` commit `1f2b9e08644c6de4a5b5c50d0e4676a19c5577c5`, described by Git as `v0.21.6+canary.20261010T070026Z-236-g1f2b9e08644`.

Checked `tui_gateway/methods_profiles.py`, `tui_gateway/methods_session.py`, `hermes_cli/web_routers/cron.py`, `hermes_cli/web_server_cron.py` and Desktop's `apps/desktop/src/api/cron.ts`:

- `profiles.list`: model/provider, lazy last-known skill count, ordinary-session metadata, background-worker timestamp. No inference of Working/Done.
- `profiles.describe {name}`: `model.default/provider`, named skills/toolsets/MCP enabled booleans. SOUL is upstream-only and discarded.
- `session.list {profile, limit:20, include_hidden:false}`: compact rows can omit `last_active`; Clanker leaves those times unknown. Hidden/canonical/internal/unknown-source rows are not ordinary history.
- Profile-scoped REST jobs include an explicit `profile`. Run reads accept `profile` and `limit`, but can fall back to another owner for an absent job: main verifies listed ownership before and after querying runs and refuses explicit foreign rows.
- Script-only `cron_output` records are included by the native runs API. These rows have no profile field in this revision; Clanker requires the exact cron-output job-ID prefix plus scoped ownership rechecks. Job state and run titles come from Hermes; Clanker never interprets an ended timestamp as success.
- Timezone and next-run values are optional. Missing fields are shown as **Not reported**, not computed locally.
- Unknown-method RPC and REST 404/405/501 yield unsupported, separate from errors and genuinely empty lists.

## Follow-up: existing dynamic-port backend adoption

The reported dev connection failure reproduced with a live packaged-Clanker-owned Hermes backend on `127.0.0.1:44173` while nothing listened on 9119. Previous Clanker discovery checked **only** 9119, missed that existing backend, and attempted another `hermes serve`. Modern Hermes may instead attach to its host singleton and exit without the readiness sentinel; the original client treated that as startup failure.

The fix uses Hermes' OS-user rendezvous records, private-owner file checks, token fingerprint and authenticated native identity verification before connecting to a discovered loopback port. Default-port discovery remains for older versions. A startup race re-discovers after exact-child cleanup, adopts the winner as external and never claims/stops it. The upstream CLI bootstrap/dependency failure documented below is not repaired or bypassed in production.

Practical verification against the user's **existing** installed backend (Hermes status `0.21.6`):

- Built `HermesAssistantService.refresh()` with an injected spawn that throws if called: **connected / external**, two profiles, no owned child. Shutdown left the existing backend untouched.
- Built native Electron with isolated app user data and `autoStart:false`: connected as **External**, opened Settings → Assistants, selected an existing profile, and received **ready** profile/history/routine sections. Closed Settings and the test app successfully. No Assistant chat was opened, no PTY viewer was replaced, no model message was sent, and no job ran.
- Existing listener/process remained on port 44173 after both tests.

Regression tests cover dynamic ports, identity mismatch, private files/symlinks/size bounds, non-loopback rejection, IPv6, token/record mismatch, recycled Linux PIDs, legacy/dead-listener fallback, sign-in refusal, no-spawn adoption and the owner-appears-during-startup race. This closes the immediate branch-testing connection blocker without requiring the independent installed launcher bootstrap repair.

## Presentation and visibility follow-up

The detail controller now composes independent overview/capability/history/routine/run components, backed by shared read-only `DataList`, `DetailSection`, `DetailCard`, `StatusLabel` and `Disclosure` primitives. Unknown run state remains unknown; no lifecycle/success inference was added. Only offset-bearing timestamp strings are localized, retaining the original ISO value; unzoned backend text is untouched.

Settings adds **Refresh profiles**, using the existing roster-refresh path, and **Hide from roster**, a bounded persisted Clanker-only preference. Hidden profiles stay in the complete Settings catalog and remain inspectable/unhideable there; visible roster projections exclude them, including opened/remembered rows. Hiding does not close a surface, PTY or Browser, create a new chat, or write any Hermes metadata. Hermes-hidden profiles are shown read-only in the manager.

Targeted regressions verify persisted visibility validation, manager/roster separation, no Hermes writes/socket closure, hide/unhide with an already-open destination, newly discovered profiles on refresh, read-only upstream hiding, semantic label/value anatomy and timezone-safe formatting. The isolated real-backend/built-Electron smoke was extended and passed hide/unhide while retaining the surface plus discovery of a newly added fixture profile through **Refresh profiles**. The updated physical screenshot was reviewed; the same native launcher/TUI limitations below still apply.

## Automated checks

Targeted main/renderer suites cover bounded and redacted projections, profile isolation, unknown IDs, foreign/duplicate jobs, ownership rechecks, removed profiles during a request, out-of-order profile selection, older API, independent failed routine reads, empty/offline states, script-output records and truthful unknown run results. Existing suites cover canonical chat and Browser continuity, zero-workspace destinations, IPC registration and enable/autostart controls.

Final command: `npm run validate` (branding, lint, typecheck, Fallow regression, security audit, build, full Vitest suite). See the implementation commit for the checked source and tests. New smoke script is explicitly a Fallow entry, not a dead-code baseline exemption.

## Practical Hermes / native Electron checks

`npm run build && node scripts/assistant-details-smoke.cjs` uses temporary Electron/Hermes homes, two named fixture profiles with disabled/paused jobs, no model messages and no job execution. It requires a working installed Hermes CLI and refuses adoption of a user-owned backend. The fixture is removed and the owned backend stopped at teardown.

The standard installed CLI attempt was **blocked**: its source-update/package-manager bootstrap tries to build `python-olm` and fails CMake, then reports no committed dependency environment. Clanker correctly reported **Hermes service exited before becoming ready**. No manual dependency repair or user-configuration change was made for this issue; the failed upstream bootstrap was left alone.

To test the backend and native UI independently of that launcher failure, an ephemeral `/tmp` CLI-directory adapter launched the installed source's `hermes_cli.web_server.start_server(host='127.0.0.1', port=0, open_browser=False, headless=True)` using its existing Python 3.11 venv, retaining Clanker's service token and isolated fixture homes. `HERMES_SMOKE_BIN_DIR` prepends this explicit test-only directory to PATH; production launch code is unchanged. This is **real installed Hermes backend source + built Electron**, not a mocked REST/RPC server, but it is **not proof that the installed CLI updater or native chat TUI works**.

That run passed:

- model/provider and capability projection from the selected named profile;
- authoritative scoped paused-job list and empty recent-run query;
- refusal to read Alpha's job from Beta;
- zero-workspace Assistant shell and canonical surface entry;
- Manage Assistant → selected-profile Settings deep-link;
- Alpha → Beta selection with no Alpha routine left visible;
- close restores Manage Assistant focus;
- explicit disable/quit cleans the owned fixture backend.

A physical Electron viewport screenshot was reviewed at `/tmp/clanker-157-assistant-details.png`; it is an ephemeral local artifact, not committed. The Settings shell remains the sole navigation framework, with progressive disclosure and a bounded output view. Actual native chat turns, Browser continuity during a native model turn, live populated cron-output history, and Windows were not manually exercised; their relevant UI/ownership invariants have automated coverage. Re-run the normal CLI smoke after repairing the independent Hermes package-manager environment.
