# Issue #60 final hardening report

> Historical issue #60 snapshot. Issue #55 subsequently implemented local/SSH harness usage and its
> header control; see the current [usage integration guide](harness-integration.md#usage-capability).

Branch: `issue-60-harness-provider-registry`, starting SHA
`eb1c8a0b973556b2fd50e5da1da26eb6797dad9c`. No PR opened. Renderer code,
controls, icons, availability presentation and workflows are unchanged.
Delivery includes the final SHA and clean/pushed working-tree verification.

## Ordered implementation commits

1. `9eac4c2` Finish provider-owned SSH attention resources
2. `32e54c1` Lazily prepare local attention resources
3. `bcc15c1` Optimize trusted Pi session resolution
4. `6029076` Automatically guard shared harness orchestration
5. `6ca1fa1` Clean provider compatibility metadata and docs
6. `8cd48f8` Record final provider hardening validation and SSH smoke evidence

Final pre-PR polish continues from `8cd48f8c8bd7e14f2cb7d1c160221caf8fba3982`:

- `c4114dc` Guard shared harness infrastructure from capability dispatch.
- Finalize issue 60 integration documentation (this report and canonical guidance).

The delivery report supplies both polish commit SHAs, including its own final SHA.

## Architectural changes

- Remote attention uploads shared observer/command infrastructure plus only the
  selected provider's resources. Providers own filenames, contents, layout,
  allowed environment keys, launch configuration and persistent plugin specs.
  SSH retains execution, locking, ownership checks, credentials and lifecycle
  transport. A private manifest records created files/directories. Cleanup
  validates all paths, owner, exact private modes and non-symlink types before
  unlinking listed files and removing empty listed directories. Unknown data and
  the manifest remain for retry; no recursive host deletion or central provider
  filename list exists. A synthetic provider contributes a nested Python file
  and environment key without changes to transport or cleanup. Persistent
  Agy/Hermes ownership and enable behavior are unchanged.
- Shared launch orchestration uses `prepareLocalAttention(harness, context)`,
  which plans configuration, lazily creates provider resources and acquires the
  provider lifecycle lease. Provider `local.prepare` describes implementation
  behavior and must not be called directly by shared orchestrators; callers must
  not manually invoke `prepareResources`.
  Local infrastructure creates the secure root, observer and command once.
  Selected provider resources are prepared synchronously and cached only after
  complete preparation in a separate private subdirectory. Failure removes only
  that directory; other providers and the shared bridge remain valid. Failure
  is retryable. Repeated/concurrent requests share successful resources; new
  roots prepare afresh. Provider cleanup and Agy's distinct reference-counted
  leases remain independent of temporary-resource preparation.
- Pi previously fully parsed each candidate transcript during trusted lookup.
  It now validates candidate file paths/types and reads only session headers,
  requires exactly one ID/workspace match, validates cwd and renderer-path
  consistency, then fully parses only that session and revalidates file/cwd.
  Renderer model/provider/title/cwd remain non-authoritative. Configured flat
  session roots, agent roots and stored `--session-dir` forms are retained.
  A 2 MiB unrelated fixture receives a header-only read; only the selected
  transcript is fully parsed. The 8192-byte stream `highWaterMark` controls read
  chunks, not a strict byte cap on the session header.
- The TypeScript AST guard recursively discovers `src/main/**/*.ts`, excluding
  provider implementation directories derived from `KNOWN_HARNESS_IDS` and the
  exhaustive `harnesses/registry.ts` record. Shared `harnesses/*.ts` infrastructure
  (including future modules) is scanned. It checks literal arrays/Sets/includes,
  comparisons in either order, switch cases and quoted/unquoted dispatch keys.
  Scalar identity defaults, comments and descriptive strings remain valid.
  Synthetic newly discovered `future/harnessUsage.ts` and
  `harnesses/usageRuntime.ts` files are checked without modifying a file allowlist;
  all seven provider directories remain excluded. No parser dependency was added.
- AI commit removed duplicate static command/args/timeout fields. Executable
  invocation and compatibility command/args/timeout all derive from
  `buildInvocation`. `modelArg` remains descriptive legacy catalog metadata;
  consistency tests verify it matches each provider's modeled invocation.
  Prompts, CLI contracts, output parsing and timeout values did not change.
- Model cache comments now distinguish cacheability from operation success,
  including Codex's intentional cacheable empty parse-failure result. OMP notes
  distinguish original 18.3.4 integration from issue #60 18.4.4 revalidation.

## Validation and smoke evidence

Previous hardening slice tests passed: SSH attention 52; local attention/IPC 75; Pi
trust/session fixtures/IPC 34; architecture 9; AI commit/model compatibility 169.
Final polish focused architecture and attention tests passed: **33 tests in
3 files**, including 11 architecture cases (with equality/inequality coverage).
Typecheck and lint passed. Final `npm run validate` passed:
branding, lint, typecheck, audit (zero vulnerabilities), build and **4,414 tests
in 209 files**. Existing history tie ordering and SSH discovery batching tests
remain intact. All seven remote providers retain their preparation execution
counts: one, except Hermes's existing second native plugin-enable execution.

Prior runtime-hardening live smoke checks used the already configured SSH account and persistent
`clanker-test` workspace fixture. OpenCode attention prepared in **one execution**,
released in **one execution**, and its 0700 root/manifest contained only shared
infrastructure and OpenCode resources. A separate read-only verification confirmed
root removal. OpenCode history returned three fixture sessions in **two
executions**. Resume and native fork both opened the TUI, prepared attention,
emitted lifecycle OSC, returned to a fallback shell after interruption and
completed cleanup. Verification probes are separate from product execution counts.
No prompt or paid/model inference was submitted; no persistent fixture data was
deleted. No extra product SSH round trips were introduced.

This final polish changed only tests and documentation, so no additional live
SSH smoke or model inference was performed. The previous OpenCode smoke remains
the runtime verification evidence; SSH batching and runtime code are unchanged.

Not verified live during the runtime-hardening pass: other harnesses' real remote runtimes, native
local model turns/input-request events, Windows/macOS execution, or model
inference. Local and all-provider remote lifecycle/security tests cover those
integration contracts; they are not claimed as live model evidence.

## Preserved capability matrix and follow-ups

No capability changes. All seven retain launch. Codex/Claude/OpenCode/Pi/OMP have
local and SSH history/resume/native fork; Agy has history/resume, local emulated
fork and unsupported SSH fork. Hermes history remains absent. Local attention
exists for all except Hermes; SSH attention exists for all seven. AI commit
remains local-only for Codex/OpenCode/Pi/OMP/Agy. Remote model discovery and AI
commit remained absent in this snapshot; usage was an unimplemented extension contract until issue #55.

Remaining follow-ups, deliberately unchanged:

- Storage compatibility: Pi/OMP history still uses conventional roots; broader
  profile/environment/local-SSH parity needs its own fixtures and migration.
- Agy global plugin ownership is process-local; Clanker does not currently
  guarantee a single instance. Cross-process retirement remains a lifecycle risk
  requiring a separate narrowly designed ownership mechanism.
- Version-sensitive Agy schema/effort/fork contracts, OpenCode local pagination,
  Hermes local history/attention absence and Codex parse/fallback compatibility
  retain their previous semantics. Future changes require separate behavior work.
- Remote cleanup remains retryable for unknown data and transport errors;
  recovery of orphan roots after crashes/disconnection remains separate work.

The provider model was not redesigned; manifests and private provider resource
directories are the smallest shared mechanisms needed to enforce its existing
ownership boundary. No UI, PTY or storage format rewrite was introduced.

## Final documentation consistency review

Reviewed all issue #60 documentation added/changed against `main`:
`harness-integration.md`, `issue-60-followup-report.md` and this report. Also checked
relevant guidance in `AGENTS.md`, `CONTRIBUTING.md`, `README.md`, `terminals.md` and
`workspaces.md`. The intermediate follow-up report is clearly marked historical
and superseded for current guidance; its test counts and implementation snapshot
are preserved. Current guidance uses `prepareLocalAttention`, lazy private local
resources, selected-provider remote resources, manifest cleanup, automatically
discovered shared guard scope and invocation-derived AI commit metadata. OMP's
18.3.4 baseline remains distinct from 18.4.4 revalidation. Candidate Pi reads are
header-only, with no claim of a strict byte cap. No remaining issue #60 guidance
requires eager preparation, central SSH filename lists or manual guard file lists.

At the start of final polish, fetched `origin/main` matched local `main` at
`fb0641d6a98e9491277c992504cba471b3e2b187`: 27 ahead / 0 behind. The two polish
commits yield 29 ahead / 0 behind; delivery rechecks fetched main and pushed HEAD.
No rebase or PR creation was performed. No correctness/security blocker was found;
the branch is ready for the requested short merge-readiness verification.

## PR CI platform correction

PR #66's first Ubuntu validation passed; Windows CI exposed three incorrect
platform assumptions in new tests. The targeted correction asserts the existing
`cmd.exe /c` resolution, native Windows discovery path separators and POSIX-only
mode checking (Windows uses inherited NTFS ACLs). Runtime code and POSIX permission
assertions are unchanged. Focused tests and full local validation are rerun before
pushing; both GitHub platform checks must pass before squash merge. This is test
portability work, not an architecture or behavior change.

## Exact materially changed files

Final polish changed exactly four files: `tests/main/unit/harnessArchitecture.test.ts`,
`docs/harness-integration.md`, `docs/issue-60-followup-report.md` and this report.
The cumulative runtime-hardening and polish list follows.

- `docs/harness-integration.md`
- `docs/issue-60-final-hardening-report.md`
- `docs/issue-60-followup-report.md`
- `src/main/agentAttentionAdapters.ts`
- `src/main/aiCommit.ts`
- `src/main/harnessCatalog.ts`
- `src/main/harnesses/agy/aiCommit.ts`
- `src/main/harnesses/claude/attention.ts`
- `src/main/harnesses/claude/remoteAttention.ts`
- `src/main/harnesses/codex/index.ts`
- `src/main/harnesses/omp/attention.ts`
- `src/main/harnesses/omp/index.ts`
- `src/main/harnesses/omp/remoteAttention.ts`
- `src/main/harnesses/opencode/attention.ts`
- `src/main/harnesses/opencode/index.ts`
- `src/main/harnesses/opencode/remoteAttention.ts`
- `src/main/harnesses/pi/attention.ts`
- `src/main/harnesses/pi/index.ts`
- `src/main/harnesses/pi/invocation.ts`
- `src/main/harnesses/pi/remoteAttention.ts`
- `src/main/harnesses/pi/sessions.ts`
- `src/main/harnesses/remoteAttentionCleanup.ts`
- `src/main/harnesses/remoteAttentionRuntime.ts`
- `src/main/harnesses/types.ts`
- `src/main/ipc/sessionIpc.ts`
- `src/main/ipc/terminalIpc.ts`
- `src/main/remote/sshAgentAttention.ts`
- `tests/main/unit/agentAttentionAdapters.test.ts`
- `tests/main/unit/aiCommitIpc.test.ts`
- `tests/main/unit/harnessAiCommitInvocation.test.ts`
- `tests/main/unit/harnessArchitecture.test.ts`
- `tests/main/unit/harnessAttentionLifecycle.test.ts`
- `tests/main/unit/harnessPiSessionTrust.test.ts`
- `tests/main/unit/harnessSessionDelegation.test.ts`
- `tests/main/unit/sshAgentAttention.test.ts`
