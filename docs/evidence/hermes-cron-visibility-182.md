# Issue #182 — Phase 3: scheduled-task visibility audit

## Post-#183 integration receipt

Owner visual acceptance was explicitly granted, and #183 is now merged at
`991739bebcdabe41df8c1cac712a9e7093bc5427`. The existing #184 branch is
updated by a non-rewriting merge of that main commit, preserving the combined
fixes/tests from the verified local rehearsal `8ddf1c5`. Actual-base validation
passed **411 suites / 7,995 tests** and the combined isolated Hermes/Electron
smoke passed. Final-head revalidation, CI and conflict-resolution details are
recorded in [hermes-integration-182.md](hermes-integration-182.md) and PR #184.
The independent baseline below is historical, not the current PR base.
#184 and parent Issue #182 remain open; SSH discovery and the native contract
limitations below remain deferred. No scheduler control or release was added.

## Historical baseline and branch

Fetched `origin/main`: `a39bf849b5a2b3d87377f7634e440f702e175ec9`.
PR #183 was **open/unmerged** at the start of this phase. This implementation is
on `issue-182-hermes-cron-visibility`, independently based on that main commit.
Neither `hermes-glowup` nor PR #183 was changed. Screenshot commit `b345270` is
not in this branch. Phase 2's presentation evidence was reviewed from its accepted
source branch; its production features are not copied into Phase 3.

**Clanker observes. Hermes owns scheduling and execution.** This is an extension
of the existing Settings → Agents & AI → Assistants page, not a cron application,
scheduler, profile manager or orchestration layer.

## What already worked

The #157 implementation (`docs/evidence/assistant-details-157.md`) already provided:

- Lazy, independent profile capability/history/routine reads from the selected
  named profile, through the authenticated main-owned service connection.
- Explicit profile-scoped job lists including disabled jobs; correct rejection
  of foreign/duplicate job ownership rather than pretending failures are empty.
- Ownership checks **before and after** a run query, necessary because the native
  endpoint can silently fall back to another profile when a requested job is gone.
- Separate ready/empty, offline, unsupported API and error states; ten-second
  deadlines, one-MiB streamed response limits, 128-job and 20-run bounds.
- No job mutation/execution request, no success inferred from an ended timestamp,
  no runtime claim inferred from worker activity. Independent failures did not
  disconnect healthy chat surfaces. Default remained excluded from named Assistants.

## Verified native contracts

Reviewed upstream `NousResearch/hermes-agent` at
`0e427d788d253630d38a3a51cd76849e73cd6925` (still the fetched `origin/main` of the
isolated upstream checkout). Native fixture smoke used installed source
`6e7b83a2f1c093e992a8d838ed77ea320fbd8e51`. These are investigated revisions,
not a claim of a minimum compatible release.

Primary source:

- [`hermes_cli/web_server_cron.py`](https://github.com/NousResearch/hermes-agent/blob/0e427d788d253630d38a3a51cd76849e73cd6925/hermes_cli/web_server_cron.py):
  `_cron_profile_home`, `_cron_store_scope`, `_call_cron_for_profile`,
  `_annotate_cron_job`, `_find_cron_job_profile`.
- [`hermes_cli/web_routers/cron.py`](https://github.com/NousResearch/hermes-agent/blob/0e427d788d253630d38a3a51cd76849e73cd6925/hermes_cli/web_routers/cron.py):
  `_job_owner_profile`, `_list_cron_jobs_sync`, `_list_cron_job_runs_sync`,
  `_list_cron_output_runs`, `_owner_home_scope`, and the GET routes.
- [`cron/jobs.py`](https://github.com/NousResearch/hermes-agent/blob/0e427d788d253630d38a3a51cd76849e73cd6925/cron/jobs.py):
  `_normalize_job_record`, `effective_job_state`, `load_jobs`, `list_jobs`,
  `mark_job_run`, and ticker heartbeat accessors.
- [`cron/executions.py`](https://github.com/NousResearch/hermes-agent/blob/0e427d788d253630d38a3a51cd76849e73cd6925/cron/executions.py):
  the profile-local execution ledger, latest records, terminal states and owner checks.
- [`hermes_cli/profiles.py`](https://github.com/NousResearch/hermes-agent/blob/0e427d788d253630d38a3a51cd76849e73cd6925/hermes_cli/profiles.py):
  `get_profile_dir('default')` resolves the native default root; named profiles
  resolve distinct homes beneath its profiles tree. Custom installations can
  have their own default root: this UI describes the **connected service's** namespace,
  not an independently configured terminal's environment.

### Claims supported / not supported

| Native data | Supported observation | Not justified |
| --- | --- | --- |
| `enabled`, `state` | Stored/normalized configuration, including paused, scheduled, completed or error | Scheduler running, imminent execution, currently executing |
| `schedule.kind` | `once` is one-shot; `cron`/`interval` recurring | Deriving kind from human display text |
| `next_run_at` | Configured next-run value, or explicitly no recorded value | Due/overdue state as a health or execution guarantee |
| `repeat.completed` | Native recorded run count | Complete per-attempt history or proof a job never executed |
| `last_run_at`, `last_status` | Last job-level recorded run/result; recognized `ok`, `error`, `interrupted`, delivery/configuration failure and skipped labels | Assigning that result to every historical row |
| `latest_execution` | Latest owner-matched ledger attempt: claimed/running/completed/failed/unknown | `running` ledger entry proving the owner is still alive |
| `started_at`, `ended_at` | Session metadata; output-document rows use document/metadata timestamps | Session end proving success, or output timestamp proving actual start time |
| `scheduler_heartbeat_age_s` | Age of a profile ticker marker | Verified live ticker, future progress, or external-provider health |
| Worker/session recent activity | Last reported activity | Proof a scheduled task is running |

`GET /api/health` checks backend process readiness, not scheduler health.
`GET /api/status` describes gateway status; a live gateway is not a live ticker.
The job-list heartbeat age does not validate its writer's live identity, cannot
certify the next tick, and does not cover all external providers. Per-run
`scheduler_owned` exists for certain agent sessions, but is not global scheduler
health and does not authorize missing-profile output rows. No narrow, bounded
scheduler-health contract was established. **Runtime health remains Unknown**;
there is no new health request or persistent polling.

## Confirmed gaps and fixes

### Ownership and confidentiality

Native run lookup treats `profile` as a **hint**. A requested profile containing
the exact job wins (including identical IDs in multiple profiles); otherwise it
searches other owners. Agent rows are annotated with the selected `profile`, but
script/output/fallback rows **omit** it. Before/after lists alone cannot prove an
unannotated row's owner: a job can disappear between requests, cause foreign
fallback, and reappear before the final check. IDs are only namespace-local.

**Fix:** every returned run must explicitly match the requested owning profile,
as well as its job/source identifier. Agent-session IDs now match the exact native
`cron_<job>_<YYYYMMDD>_<HHMMSS>` grammar, not a broad prefix which could accept a
longer colliding job ID. Duplicate IDs, foreign/missing profile identity and
conflicting latest-ledger job IDs fail closed. Existing before/after checks remain.

**Deliberate limitation:** current native unannotated script/output history is
**unavailable**, not empty; no timestamps, titles or previews from those rows are
shown. A reliable native owner-stamped history envelope/row is required to restore
that coverage. This is a conservative reduction of previously unsafe visibility,
not a claim that script-only jobs never ran. Explicitly owner-stamped script rows
are accepted if an installation provides that contract.

Native output titles may embed output/error text; prompt-derived job labels also
exist (`_normalize_job_record` uses prompt/skill/script fallback). Merely stripping
`token=...` assignments does not sanitize arbitrary secrets or prompts.

**Fix:** run projections contain only validated source and timestamps, with fixed
UI record titles. No native run title, output/error preview, raw output or prompt
is forwarded. Synthesized prompt/skill/script job names use a neutral label.
Backend credentials are removed **before** display truncation; native custom
home/workdir/script paths are redacted in supported job display fields. Unknown
states/results are not forwarded as arbitrary backend text. Raw ledger errors,
process identities, storage paths and payloads remain main-only.

### Default-profile tasks

The default profile has its own `cron/jobs.json`, execution ledger, output and
session stores. `GET /api/cron/jobs?profile=default` selects this namespace, calls
`list_jobs(True)` and stamps each job `profile:'default'`. It is **not**
`profile=all`; the latter aggregates and deduplicates identical IDs, preferentially
keeping default copies, so Clanker never uses it.

**Implemented:** a separate **Default Hermes · Scheduled tasks** disclosure in
existing Assistant Settings. It reads only on expansion/explicit refresh through
two narrow main-owned IPCs (default list and default job history); the default
namespace is hard-coded in main. Named routines reuse the same bounded reader.
Each job must explicitly belong to `default`; history keeps the same stricter
checks as named profiles. No `hermes:default` registration, roster item, canonical
chat lookup/create, PTY, Browser owner, Workspace or new app destination is added.

If the service is unavailable/disabled, the view explains that the ordinary CLI
can still work independently; it neither launches a helper/service nor reads the
CLI's filesystem. Existing optional Assistants enable/autostart policy remains
unchanged. Without the canonical local CLI, the existing feature remains dormant.

### Presentation, bounds and recovery

- Enabled/disabled badge is separate from **Hermes configuration state**.
  Schedule kind is explicit; timezone and offset-bearing dates reuse existing
  formatting. **Configured next run** is never a countdown/health badge.
- Explicit `null` dates mean **No next run recorded / No run recorded**; absent
  fields remain **Not reported**. A zero count is a recorded count, not an absolute
  “Never executed” assertion. Empty history explicitly does not prove a task never ran.
- Recognized last job results and latest structured ledger attempts are shown;
  claimed/running records explicitly say **liveness unverified**. Individual
  history result stays Unknown: the inspected endpoint has no structured per-run
  result, and Clanker will not parse human title prefixes to manufacture one.
- Unsupported endpoint, read failure, offline and ownership-unavailable remain
  distinct from empty lists. Runs whose owner cannot be proved get an explicit
  explanation, not “No runs yet”. Output-document timestamps are not labeled as
  proven start/end times.
- Shared cron reads coalesce per namespace/job, cap eight in-flight operations,
  bound ten seconds/one MiB/128 jobs/20 runs, and invalidate on roster refresh,
  connection loss, disable and shutdown. Stale callbacks cannot populate another
  profile or a refreshed view. No completed-result cache or recurring poll is added.
  Exceeding bounds is an error/unavailable state, **not silent truncation** of job lists.
- Completed/removed one-shot jobs may no longer appear in Hermes' current job
  list. No independent historical inventory of removed jobs was established.
  This view cannot promise all past jobs or all historical attempts.

## Upstream read-purity limitation / architecture boundary

All Clanker cron requests are the existing authenticated **GET** list/run routes;
there is no create/edit/delete/pause/resume/trigger/retry/provider-reconcile call,
scheduler startup, CLI subprocess, local filesystem cron adapter or remote access.

Nevertheless, native `cron.jobs.load_jobs()` creates store directories and may
repair malformed `jobs.json` (legacy shapes, junk rows, invalid counters) via
`save_jobs`. Execution-ledger queries initialize schemas, and native read-only
session helpers can bootstrap/heal stores. Therefore **HTTP GET does not guarantee
zero native filesystem changes**. The valid paused fixtures remained byte-for-byte
unchanged, but that is not proof of repair-free reads for malformed stores.

Clanker does not invoke a native mutator to fix that limitation. If a strict
no-write guarantee is required even for corrupt/legacy stores, an upstream
repair-free read capability is a prerequisite (or a separately approved policy to
hide existing native views). This phase cannot honestly certify that guarantee.
Hermes remains responsible for its own read-side maintenance. No new scheduler
orchestration is proposed as a workaround.

## Verification

- **Focused automated checks:** seven main/renderer suites, **349 tests**, covering
  named/default overlap, malformed/foreign/missing owner responses, exact run IDs,
  paused/disabled and one-shot/recurring config, recognized results, typed latest
  records, unknown health, safe projection, bounds, coalescing, deadlines,
  refresh/disconnect/reconnect, unavailable vs empty, and stale UI callbacks.
  Existing canonical chat, hiding, availability, Browser/zero-workspace and IPC
  tests remain in the full suite. Read tests assert no spawn/chat/mutation calls.
- **Native fixture smoke passed:** built Electron plus the real installed Hermes
  backend source, isolated temporary homes and paused/non-executing fixture jobs.
  Default, Alpha and Beta share one job ID; seeded past output documents contain
  explicit fixture secrets. Native unowned output history is withheld for all
  three; default one-shot/failed recorded metadata and named recurring config are
  visible. Default Settings/refresh, namespace separation, foreign-job refusal,
  unchanged healthy `jobs.json` bytes, existing details/hiding/profile switching,
  zero-workspace canonical surface and asynchronous focus return passed. **No
  cron job was executed**; past output/status/counts were synthetic fixture data.
- The existing `HERMES_SMOKE_BIN_DIR` hook used a private temporary adapter to the
  installed Python 3.11 backend source (`start_server`), not normal CLI dependency
  bootstrap, paid chat, a user backend or user profiles. This proves backend/
  bridge/UI interoperability, not normal launcher health. Fixture homes and the
  owned backend were cleaned up; physical screenshot reviewed at
  `/tmp/clanker-182-cron-visibility.png` (ephemeral, not committed).
- No live SSH or native Windows testing. Remote inventory remains blocked by the
  separate upstream discovery prerequisite. PR #183 avatar/appearance work is
  neither required nor expanded here.
- **`npm run validate` passed:** branding → lint → typecheck → Fallow full/production
  identities → security → build → **406 suites / 7,912 tests**. Security uses only
  the existing documented dev-only `GHSA-ch52-4w7c-c8xp` exception; no other high/
  critical gate findings. Existing bundle-size/localStorage warnings are non-failing.

## Follow-ups, not shipped

Native owner-stamped script/output history and structured per-run results;
repair-free job/history reads; a genuine bounded scheduler-health contract;
historical removed-job inventory if Hermes exposes one. None is replaced with
Clanker scans, polling/supervision, execution controls, profile orchestration or
SSH services. No merge or release is part of this phase.
