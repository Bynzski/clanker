# Agent Directive: Execute Plan Phase

Self-contained instructions for an agent to execute one phase of a multi-phase implementation plan.

---

## How It Works

1. **Read progress** — Load `plans/<plan-name>/PROGRESS.md`. Find the first phase with status:
   - 🔲 (not started) → this is the next phase
   - 🔧 (in progress) → resume this phase

2. **Read plan** — Load `plans/<plan-name>/PLAN.md`. Study the target phase section:
   - Scope: what to do
   - Out of scope: what NOT to do
   - Files: what to create/modify
   - Context: what patterns to follow

3. **Read architecture** — Load `AGENTS.md`. Follow all rules.

4. **Execute** — Implement the phase per plan scope.

5. **Validate** — Run the project's validation command (`npm run validate` or equivalent).

6. **Commit** — Commit with format:
   ```
   <type>(<scope>): phase <N> — <short description>

   <bullet list of changes>

   Phase <N> of plans/<plan-name>/PLAN.md
   ```

7. **Update progress** — Mark phase as ✅ with commit hash in `PROGRESS.md`.

---

## Rules

1. Read ALL context files (PLAN.md, PROGRESS.md, AGENTS.md) before writing code.
2. Execute ONLY the scope defined in the current phase. Do NOT:
   - Modify files outside phase scope
   - Refactor unrelated code
   - Add features not in scope
3. Follow all rules in `AGENTS.md`. If unsure, re-read it.
4. Use existing codebase patterns — do not invent new patterns.
5. Run validation frequently. Fix errors immediately.
6. If blocked, report immediately. Do NOT work around blockers silently.

---

## Completion

When the phase is complete and validation passes:

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

### Commit
<hash>

### Ready for Next Phase
YES/NO
```

Then update `plans/<plan-name>/PROGRESS.md`:
- Set completed phase status to ✅ with commit hash
- Set next phase status to 🔲 (or 🔧 if running in a loop)

---

## Invocation Patterns

### User-Prompted Session
```
Execute the next phase of the api-update plan.
PLAN_PATH: plans/api-update/
```

### Programmatic Loop
Automated runner invokes the agent repeatedly. Each invocation:
1. Reads PROGRESS.md
2. Picks next phase
3. Executes phase
4. Updates PROGRESS.md
5. Returns completion report

Loop terminates when all phases are ✅.
