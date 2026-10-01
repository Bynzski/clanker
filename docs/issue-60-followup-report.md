# Issue #60 follow-up branch report

Branch: `issue-60-harness-provider-registry`. No PR opened. Changes remain main
process/provider/test/documentation work; renderer controls, icons and workflows
are unchanged. The final SHA is reported with delivery (a report cannot contain
its own commit SHA).

## Follow-up commits in order

- `6448a2c Enforce explicit launch identity and session transport contracts`
- `8a5d077 Delegate local attention resource preparation and shutdown to providers`
- `d17f5ad Build provider-specific noninteractive AI commit invocations`
- `8dfd1a0 Separate model discovery success from compatibility caching policy`
- `3bef1ed Resolve Pi local session identity from trusted configured stores`
- `71a7ae6 Guard shared orchestration against literal harness support matrices`
- `13e8f13 Validate Agy streaming inference and strengthen provider boundary regressions`
- `41df799 Project AI commit compatibility arguments from canonical invocations`
- `e5d0836 Revalidate trusted Pi working directories before launch and persistence`

- Final documentation commit: this report and the updated integration playbook.

## Architectural fixes

1. Launch takes the selected provider's model-argument function explicitly.
   Executable names are no longer looked up as IDs. Serializable catalogs omit
   functions. A synthetic alternate executable preserves Hermes's exact provider
   decoding and argument ordering.
2. `buildSessionCommand` requires operation and transport and rejects absent or
   restricted operations with a typed unsupported error. Local and SSH launches
   use this boundary. All resume/fork argv expectations run through it for both
   transports; Agy local fork is emulated and SSH fork is rejected.
3. Local attention providers create their settings, extensions and plugin files
   through `prepareResources`. Shared adapter files contain only the command
   bridge. Generic infrastructure keeps the secure root, observer, cleanup and
   rollback. Agy owns shutdown retirement; distinct preparation leases preserve
   ref counts, out-of-order and retryable disposal. Resource failures and spawn
   failures have regression coverage. No SSH connections moved into providers.
4. AI commit providers build actual command/argv/stdin/timeout/environment
   invocations. Shared Git context, prompts, text normalization, desktop PATH and
   Windows resolution remain shared. OpenCode uses `run`, Pi explicit print mode,
   and Agy documented JSON stdin with provider-owned result-envelope parsing.
   Agy uses stdin to avoid Windows prompt quoting and command-line size limits.
   Compatibility argv helpers project those same invocations.
5. Detailed model results separate discriminated operation success/failure from
   cache policy. Codex malformed output stays a parse failure while its historical
   cacheable empty compatibility result remains. Success, empty, fallback,
   cached discovery, explicit refresh and stale warmup race coverage remain.
6. Pi IPC awaits provider validation before constructing argv. Provider lookup
   resolves identity from trusted configured roots and fresh on-disk metadata,
   ignoring renderer metadata as authority and rejecting mismatching paths,
   traversal aliases, symlinks, missing and duplicate IDs. Trusted cwd containment
   is rechecked and persistence uses authoritative metadata in IPC path form. Invocation supports
   agent/session environment roots and stored explicit session-directory flags.
   History discovery intentionally remains conventional rather than expanding UX.
7. The architecture guard uses the installed TypeScript AST, scoped to shared
   orchestration. It rejects literal ID arrays/Sets, comparisons in either order,
   switch cases and dispatch object keys, with synthetic regressions. Providers,
   presentation mappings, identity metadata and capability expectation tests are
   outside this guard.

## Capability matrix

| Harness | Local models | History local / SSH | Fork local / SSH | Attention local / SSH | Local AI commit |
| --- | --- | --- | --- | --- | --- |
| Codex | native | JSONL / JSONL | native / native | notify / notify | exec stdin, 60s |
| Claude | absent | JSONL / JSONL | native / native | hooks / hooks | absent |
| OpenCode | CLI + fallback | native CLI / native CLI | native / native | plugin / plugin | run stdin, 90s |
| Pi | native | JSONL / JSONL | native / native | extension / extension | print stdin, 45s |
| OMP | native | JSONL / JSONL | native / native | extension / extension | isolated print stdin, 60s |
| Hermes | gateway | absent / absent | absent / absent | absent / observer | absent |
| Agy | CLI + fallback | SQLite / SQLite | emulated / unsupported | owned plugin / inert owned plugin | JSON stdin/result, 60s |

All have interactive launch; all integrated history capabilities have resume.
Models and inference remain local-only. Usage remains an extensible, unimplemented
contract. No new capabilities or controls were invented.

## Preserved behavior and differences

- Model picker fallback lists, TTL, Hermes refresh/provider selection, Codex
  malformed-output compatibility and history timestamp tie order remain intact.
- SSH discovery execution order and count remain intact: all six providers use
  three executions; OpenCode alone uses two. Host probing remains one command.
- Local scans and SSH recursive/bounded scans keep their existing differences.
  OpenCode retains native SQLite/legacy handling and local default pagination.
- Pi/OMP history still assumes conventional stores. Pi invocation alone now
  honors trusted configured stores to harden its file boundary safely.
- Local Agy global-session/title/schema behavior remains. SSH requires workspace
  evidence and rejects emulated fork. Agy manual global plugin path is retained.
- Hermes local history/attention are absent; SSH observer attention remains.
- PTYs, wrappers, user flag ordering, fallback shell and Windows resolution remain.

## Validation and actual smoke checks

Final `npm run validate`: passed branding, lint, typecheck, security audit (zero
vulnerabilities), build and **4,400 tests in 209 files**. Focused tests and
lint/typecheck passed for each slice. History tie ordering and the three-execution
SSH discovery contract are covered by the unchanged regression tests.

Installed help/version contracts checked: Codex 0.159.3, OpenCode 1.18.34,
Pi 0.87.1, OMP 18.4.4, Hermes 0.21.5 and Agy 1.2.14. Claude's shim reports a
missing native binary; it was not reinstalled as part of this task.

Actual Linux PTY checks (no submitted model prompts):

- Local command startup attempts for all seven shims reached the wrapper fallback
  shell, with no attention credential leakage detected there. Claude failed to
  start its missing binary; the other six produced startup output. These checks
  establish command/wrapper execution, not completed model interaction.
- Provider-built model arguments plus the `--help` user flag were accepted by
  all six working CLI parsers (including Hermes provider-qualified decoding);
  Claude remained blocked by the missing binary.
- Provider local discovery succeeded for Codex, Claude, OpenCode, Pi, OMP and Agy
  against this repository. Hermes has no history capability.
- Existing local sessions were opened through canonical resume and fork argv for
  Codex, OpenCode, Pi, OMP and Agy and interrupted without prompts. All reached
  fallback with no matched invalid-session diagnostic. Agy's fork check was its
  declared emulated resume. Claude resume/fork was blocked by its missing binary.
- Local Pi and OMP extensions delivered native `session_ended` to the real
  loopback broker on shutdown, without the wrapper supplying that event.
- Agy model listing and native `--print /help` returned metadata without inference.
  Explicit plain/empty print probes rejected missing prompt arguments. JSON input
  emitted init/result and rejected an unsupported control message without a model
  turn, verifying the stream contract safely.
- The already-saved SSH host was reachable; persistent `clanker-test/README.md`
  remained intact. OpenCode was the only installed remote harness. Live provider
  discovery returned three fixture sessions in two executions. Remote startup,
  existing-session resume and native fork reached the remote fallback shell.
  Attention-enabled resume/fork emitted shutdown OSC frames; owned launch cleanup
  completed. No persistent fixture was removed or new SSH target configured.

Real model replies, turn-start/completion and input-request/resolution delivery
were **not** exercised; no paid/model inference was submitted. Lifecycle source,
broker transport, synthetic native hook/PTY fixtures, concurrency, rollback,
cleanup failure and spawn failure are covered by automated tests. Native Windows
and macOS execution were not available. UI visual/manual app testing was not
performed. Successful AI commit model responses remain unverified; invocation
contracts and output parsing are covered without billing.

## Follow-ups with severity

- **High reliability: multi-process Agy plugin ownership.** No Electron single
  instance lock exists. Process-local ref counts can overwrite/remove another
  running Clanker's global plugin. Decide single-instance policy or small explicit
  cross-process ownership before claiming multi-process lifecycle safety.
- **Medium: Pi/OMP storage parity.** Pi configured-store history and SSH discovery
  remain conventional. OMP 18.4.4 uses PI-named directory variables, profiles and
  existence-dependent XDG relocation. `OMP_HOME`/`OMP_CODING_AGENT_DIR` were not
  present in the version-specific resolver; do not freeze guessed aliases into
  providers. Add versioned root specs with host-side resolution and fixtures.
- **Medium: native attention compatibility smoke.** Real-turn/input events need
  controlled model testing, especially Agy and the missing Claude installation.
  Hermes's intentional transport asymmetry should remain explicit.
- **Medium: evolving Agy schema/model/effort contracts.** Current native help and
  web docs differ on effort values; flags remain opaque. Fixed SQLite schema and
  global fallback remain version-sensitive. No native fork is exposed.
- **Low: local OpenCode pagination and parser compatibility.** Local list pagination
  is unchanged while SSH rejects truncation. Codex empty parse caching and Pi/
  OpenCode permissive parsing remain compatibility decisions for separate tickets.

The design stays small: provider resource contributions and concrete AI commit
invocations extend the existing registry, without a general plugin/inference
framework. Correcting OpenCode's bare TUI invocation, making Pi print mode explicit, and
using Agy's documented stream contract are the intentional noninteractive
invocation changes requested by this follow-up.

## Exact materially changed files

- `docs/harness-integration.md`
- `docs/issue-60-followup-report.md`
- `src/main/agentAttentionAdapters.ts`
- `src/main/aiCommit.ts`
- `src/main/environment/localEnvironment.ts`
- `src/main/harnessCatalog.ts`
- `src/main/harnessLaunch.ts`
- `src/main/harnesses/agy/aiCommit.ts`
- `src/main/harnesses/agy/index.ts`
- `src/main/harnesses/claude/attention.ts`
- `src/main/harnesses/claude/index.ts`
- `src/main/harnesses/codex/index.ts`
- `src/main/harnesses/omp/attention.ts`
- `src/main/harnesses/omp/index.ts`
- `src/main/harnesses/opencode/attention.ts`
- `src/main/harnesses/opencode/index.ts`
- `src/main/harnesses/pi/attention.ts`
- `src/main/harnesses/pi/index.ts`
- `src/main/harnesses/pi/invocation.ts`
- `src/main/harnesses/pi/sessionRoots.ts`
- `src/main/harnesses/pi/sessions.ts`
- `src/main/harnesses/types.ts`
- `src/main/ipc/aiCommitIpc.ts`
- `src/main/ipc/sessionIpc.ts`
- `src/main/ipc/terminalIpc.ts`
- `src/main/remote/sshEnvironment.ts`
- `src/main/sessionHistory.ts`
- `src/main/sessionLaunch.ts`
- `tests/main/unit/agentAttentionAdapters.test.ts`
- `tests/main/unit/aiCommit.test.ts`
- `tests/main/unit/aiCommitIpc.test.ts`
- `tests/main/unit/harnessAiCommitInvocation.test.ts`
- `tests/main/unit/harnessArchitecture.test.ts`
- `tests/main/unit/harnessAttentionLifecycle.test.ts`
- `tests/main/unit/harnessCatalog.electron.test.ts`
- `tests/main/unit/harnessLaunch.test.ts`
- `tests/main/unit/harnessPiSessionTrust.test.ts`
- `tests/main/unit/harnessRegistry.test.ts`
- `tests/main/unit/sessionIpc.test.ts`
- `tests/main/unit/sshSessionLaunch.test.ts`
