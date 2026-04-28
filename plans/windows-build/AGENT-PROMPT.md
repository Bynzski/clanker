# Agent Directive: Execute Windows Build Phase

Self-contained instructions for an agent to execute one phase of `plans/windows-build/PLAN.md`.

---

## Plan

- **PLAN_NAME:** `windows-build`
- **PLAN_PATH:** `plans/windows-build/`
- **Source-of-truth gap doc:** `plans/windows-build-gap-analysis.md`

## How It Works

1. **Read progress** — Load `plans/windows-build/PROGRESS.md`. Find the first phase with status:
   - 🔲 (not started) → this is the next phase
   - 🔧 (in progress) → resume this phase

2. **Read plan** — Load `plans/windows-build/PLAN.md`. Study the target phase section:
   - **Scope:** what to do
   - **Out of Scope:** what NOT to do
   - **Files to Modify / New Files:** the change surface
   - **Context Files to Read:** patterns to follow

3. **Read architecture** — Load `AGENTS.md`. Follow all rules — especially:
   - Main/renderer separation. Renderer must not import Node `os`/`fs`/etc.
   - All paths crossing IPC use POSIX separators (after Phase 3 lands).
   - `npm run validate` must pass before considering the phase complete.

4. **Execute** — Implement the phase per plan scope only. Do not gold-plate.

5. **Validate** — Run `npm run validate` (lint → typecheck → build → test).
   - Lint: `npm run lint`
   - Typecheck: `npm run typecheck`
   - Build: `npm run build`
   - Test: `npm run test`
   - Full chain: `npm run validate`

6. **Commit** — Use the format below.

7. **Update progress** — Mark the phase ✅ with the commit hash in `PROGRESS.md`.

---

## Rules

1. Read `PLAN.md`, `PROGRESS.md`, and `AGENTS.md` before writing code.
2. Execute ONLY the scope of the current phase. Do NOT:
   - Modify files outside phase scope
   - Refactor unrelated code
   - Add features not listed in the phase
3. Follow `AGENTS.md`. If unsure, re-read it.
4. Use existing patterns. Mirror `src/main/ipc/terminalIpc.ts` for platform branching, `src/main/harnessCatalog.ts` for `path.delimiter`, etc.
5. Linux must stay green throughout. Run `npm run validate` on Linux before committing every phase. Phase 9 must also verify the Linux AppImage release artifact still builds.
6. If blocked, update `PROGRESS.md` to ❌ with a Blocking Issues note. Do NOT silently work around blockers.
7. **Phase 2 and Phase 9** require a real Windows host (or VM) for manual smoke testing. Phase 9 also requires a Linux host/VM for AppImage smoke. If running headless, mark the phase 🔧 and report the manual steps the user needs to run.

---

## Commit Format

```
<type>(<scope>): phase <N> — <short description>

- bullet list of changes

Phase <N> of plans/windows-build/PLAN.md
```

Examples:

```
ci(windows): phase prereq — add windows-latest matrix entry

- Add windows-latest to validate.yml matrix
- Gate npm-audit and dep-review on ubuntu-latest
- continue-on-error: true on the windows leg

Phase Prereq of plans/windows-build/PLAN.md
```

```
fix(main): phase 1 — cross-platform harness wrapper and shell defaults

- Branch harnessLaunch wrapper on process.platform
- Replace hardcoded ":" PATH join with path.delimiter in sessionHistory.ts
- Align sessionIpc default shell with terminalIpc (powershell.exe on win32)
- Verify renderer has no user-facing /home/... copy; document if no UI change is needed

Phase 1 of plans/windows-build/PLAN.md
```

---

## Completion Report

When the phase is complete and validation passes, report:

```
## Phase <N> Complete

### Files Changed
- <file>: <what>

### New Files
- <file>: <purpose>

### Validation
- lint: PASS/FAIL
- typecheck: PASS/FAIL
- build: PASS/FAIL
- test: PASS/FAIL
- (Windows CI, where applicable): PASS/FAIL/PENDING

### Manual Steps Required (if any)
- <if Phase 2, 8d, or 9 needs manual Windows verification — list the smoke tests for the user>

### Commit
<hash>

### Ready for Next Phase
YES/NO
```

Then update `plans/windows-build/PROGRESS.md`:
- Set the completed phase status to ✅ with commit hash.
- Set the next phase status to 🔲 (or 🔧 if running in a loop).

---

## Hard Stops

Stop and report (do NOT keep going) if any of the following occurs:

- `npm run validate` fails on Linux after the phase changes.
- A phase's scope conflicts with `AGENTS.md` rules — flag it and ask.
- A phase requires a manual Windows host smoke and you don't have access — mark 🔧, leave clear instructions.
- The Phase 3 path-normalization audit reveals an IPC site whose semantics aren't obvious — flag it for the user before guessing.
- Code-signing scope creep — Phase 9 is **unsigned**. Do not pull in signing work.
- Phase 9 release publishing/tagging would require credentials or maintainer approval you do not have — prepare artifacts/instructions instead of publishing.

---

## Invocation

### User-Prompted

```
Execute the next phase of the windows-build plan.
PLAN_PATH: plans/windows-build/
```

### Programmatic Loop

Automated runner invokes the agent repeatedly. Each invocation:
1. Reads `PROGRESS.md`
2. Picks next 🔲 phase
3. Executes per scope
4. Updates `PROGRESS.md`
5. Returns the completion report

Loop terminates when all phases are ✅, or when a phase reports ❌ with blocking issues.
