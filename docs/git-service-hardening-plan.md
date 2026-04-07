# Git Service Hardening Plan

Date: 2026-04-07
Status: **Plan — ready for execution**

---

## Validation Summary

All 6 bugs and 10 test gaps from `git-service-review-2026-04-07.md` have been **confirmed** against the current source:

| # | Finding | Validated | Location |
|---|---------|-----------|----------|
| Bug 1 | `.trim()` corrupts first-line status parsing | ✅ Confirmed — `parseGitStatus` line 136 | `gitService.ts:136` |
| Bug 2 | Test prefix fragility in `getConflictingFiles` | ✅ Confirmed — harmless in production, test fragility is real | Test file |
| Bug 3 | `CHERRY_PICK_HEAD` not detected | ✅ Confirmed — `getOperationState` only checks MERGE/REBASE | `gitService.ts:222–258` |
| Bug 4 | `getHistory` re-throws unhandled errors | ✅ Confirmed — only method that can throw; IPC handler is unwrapped | `gitService.ts:379–393`, `main.ts:696–702` |
| Bug 5 | `listStashes` has no error handling | ✅ Confirmed — bare `execGit` call, no try-catch | `gitService.ts:312–322`, `main.ts:693` |
| Bug 6 | `stage([])` triggers `add -A` | ✅ Confirmed — empty array falls through to "stage all" | `gitService.ts:596` |

Current test suite: **66/66 passing**, 94.1% statement coverage. Green but incomplete.

---

## Execution Plan

### Phase 1: Critical Bug Fixes (do first, before new tests)

#### 1A. Fix Bug 1 — Remove `.trim()` from `parseGitStatus`

**File:** `src/main/gitService.ts` line 136

**Change:**
```typescript
// BEFORE (broken)
const lines = statusOutput.trim().split('\n').filter(Boolean);

// AFTER (fixed) — strip only leading/trailing blank lines, not whitespace
const lines = statusOutput.replace(/^\s*\n/, '').replace(/\n\s*$/, '').split('\n').filter(Boolean);
```

Actually, the simpler fix: just remove `.trim()`. The `.filter(Boolean)` already drops empty lines from trailing newlines, and git status --porcelain never outputs leading blank lines:

```typescript
// AFTER — simplest correct fix
const lines = statusOutput.split('\n').filter(Boolean);
```

**Why:** `git status --porcelain` never outputs blank lines — only `XY PATH` lines. The `.filter(Boolean)` already handles any trailing newline. The `.trim()` was defensive but actively harmful for lines where X is a space.

#### 1B. Fix Bug 4 — `getHistory` should not throw

**File:** `src/main/gitService.ts` lines 379–393

**Change:**
```typescript
// BEFORE
throw error;

// AFTER
return [];
```

Catch-all: return `[]` for any unrecognized error, matching the behavior for "no commits" and "unknown revision." This makes `getHistory` consistent with every other method — it never throws.

#### 1C. Fix Bug 5 — `listStashes` error handling

**File:** `src/main/gitService.ts` lines 312–322

**Change:** Wrap in try-catch:
```typescript
async listStashes(workspacePath: string): Promise<GitStashEntry[]> {
  try {
    const { stdout } = await this.execGit(workspacePath, [
      'stash', 'list', '--format=%H%x1f%gd%x1f%gs',
    ]);
    return this.parseDelimitedRows(stdout, ([hash = '', ref = '', message = '']) => ({
      hash, ref, message,
    }));
  } catch {
    return [];
  }
}
```

---

### Phase 2: Behavior Fix (design decision needed)

#### 2A. Fix Bug 6 — `stage([])` should be a no-op

**File:** `src/main/gitService.ts` line 596

**Decision required:** Should `stage()` with no args stage everything (current), or should it be explicit?

**Recommended change:** Distinguish `undefined` (stage all) from `[]` (no-op):
```typescript
// BEFORE
const args = files && files.length > 0 ? ['add', '--', ...files] : ['add', '-A'];

// AFTER
if (files === undefined) {
  args = ['add', '-A'];
} else if (files.length > 0) {
  args = ['add', '--', ...files];
} else {
  return { success: true }; // empty array → no-op
}
```

#### 2B. Bug 3 — Add `CHERRY_PICK_HEAD` detection (Low priority)

**File:** `src/main/gitService.ts` lines 244–258 (inner catch block)

Add a third check after REBASE_HEAD:
```typescript
} catch {
  try {
    await this.execGit(workspacePath, ['rev-parse', '--verify', 'CHERRY_PICK_HEAD']);
    mode = 'merge'; // cherry-pick aborts via merge --abort
    inProgress = true;
    message = 'Cherry-pick in progress';
  } catch {
    mode = 'none';
    inProgress = false;
    message = 'No merge in progress';
  }
}
```

---

### Phase 3: New Tests (implement after bug fixes)

All new tests go in `tests/main/unit/gitService.test.ts`.

| Gap | Test Description | Priority |
|-----|-----------------|----------|
| **Gap 1** | `parseGitStatus` with leading-space status (` M file.txt` as first line) — verifies fix for Bug 1 | 🔴 Critical |
| **Gap 5** | `listStashes` when `git stash list` fails — verifies fix for Bug 5 | 🔴 Critical |
| **Gap 7** | `getHistory` with unexpected error (not "no commits" / "unknown revision") — verifies fix for Bug 4 | 🔴 Critical |
| **Gap 9** | `stage([])` empty array is a no-op — verifies fix for Bug 6 | 🟡 High |
| **Gap 3** | Standalone `getConflictingFiles` test: args, empty list, multiple files | 🟡 High |
| **Gap 6** | `getHistory` limit clamping: 0→1, 100→50, -1→1, default 8 | 🟡 High |
| **Gap 8** | `parseGitStatus` with renamed entry `R  old -> new` | 🟢 Medium |
| **Gap 4** | `getDiff('commit', shortRef)` where ref < 12 chars | 🟢 Medium |
| **Gap 10** | `startPolling` called twice — old interval stopped, new one started | 🟢 Medium |
| **Gap 2** | Fix `getBranches` test to use full format string prefix | 🟢 Low |

#### Test implementation sketch for Gap 1 (the critical trim test):

```typescript
it('correctly parses first-line unstaged modification (no trim corruption)', async () => {
  addResponse('rev-parse --git-dir', { stdout: '.git' });
  addResponse('status --porcelain', {
    stdout: ' M file.txt\nA  staged.ts',
  });
  addResponse('branch --show-current', { stdout: 'main' });

  const result = await service.getStatus('/workspace');

  expect(result.changes).toHaveLength(2);
  expect(result.changes[0]).toEqual({
    path: 'file.txt',
    status: 'modified',
    staged: false,
  });
  expect(result.changes[1]).toEqual({
    path: 'staged.ts',
    status: 'added',
    staged: true,
  });
});
```

---

### Phase 4: Design Improvements (future backlog)

These are **not blockers** but should be tracked:

1. **Concern 1:** Replace magic numbers in `parseGitStatus` with destructuring (`line[0]`, `line[1]`, `line.slice(3)` → named extraction)
2. **Concern 2:** Simplify `parseBranchList` current-branch detection (use only HEAD marker)
3. **Concern 3:** Standardize error return shapes across all methods — every public method should return `{ success, error? }` or be explicitly documented as infallible

---

## Execution Order

```
Step 1: Fix Bug 1 (trim)           → src/main/gitService.ts
Step 2: Fix Bug 4 (getHistory)     → src/main/gitService.ts
Step 3: Fix Bug 5 (listStashes)    → src/main/gitService.ts
Step 4: Fix Bug 6 (stage [])       → src/main/gitService.ts
Step 5: Fix Bug 3 (cherry-pick)    → src/main/gitService.ts
Step 6: Add Gap 1, 5, 7 tests      → tests/main/unit/gitService.test.ts
Step 7: Add Gap 3, 6, 9 tests      → tests/main/unit/gitService.test.ts
Step 8: Add Gap 2, 4, 8, 10 tests  → tests/main/unit/gitService.test.ts
Step 9: Run full test suite         → verify all pass
Step 10: Run coverage               → verify ≥ 95% statements
```

Each step should be independently committable. Steps 1–3 are critical and should be merged immediately. Steps 4–5 are high value. Steps 6–10 are test hardening.

---

## Risk Assessment

| Change | Risk | Mitigation |
|--------|------|------------|
| Remove `.trim()` | Low — git porcelain never has blank lines | `filter(Boolean)` already handles trailing newline |
| `getHistory` return `[]` | Very low — renderer already handles `[]` | Consistent with other error paths |
| `listStashes` try-catch | Very low — returns `[]` on error | Renderer handles empty array gracefully |
| `stage([])` no-op | Medium — callers might depend on current behavior | Audit callers before changing; `stage()` (no args) still stages all |
| Cherry-pick detection | Low — adds a new git command call | Only runs when MERGE_HEAD and REBASE_HEAD are absent |
