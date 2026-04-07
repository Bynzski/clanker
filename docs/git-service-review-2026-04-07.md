# Git Service Review: Implementation and Test Coverage

Date: 2026-04-07
Reviewer: pi (automated code review)

## Scope

- Implementation: `src/main/gitService.ts` (758 lines)
- Tests: `tests/main/unit/gitService.test.ts` (66 tests, 94.1% statement coverage)
- IPC wiring: `src/main/main.ts` (git handler section)

---

## Implementation Bugs

### Bug 1: `parseGitStatus` — `.trim()` on full output silently corrupts first-line parsing

**Severity: High**
**Lines:** `gitService.ts:136` (`statusOutput.trim()`)

`git status --porcelain` outputs two-character status codes followed by a space and the path:

```
XY PATH
```

When the first line's index status (X) is a space — meaning the change is only in the worktree — the line starts with a space character (e.g. ` M file.txt`). Calling `.trim()` on the entire output string strips this leading space, causing the first line to shift by one character:

| Input | After `.trim()` | Parsed X | Parsed Y | Parsed path |
|---|---|---|---|---|
| ` M file.txt` | `M file.txt` | `M` (wrong) | ` ` (wrong) | `ile.txt` (wrong) |
| `A  staged.ts` | `A  staged.ts` | `A` | ` ` | `staged.ts` (correct) |

The status is incorrectly reported as **staged modified** instead of **unstaged modified**, and the file path is corrupted (`ile.txt` instead of `file.txt`).

This affects any status where the first changed file is an unstaged modification (` M`), unstaged deletion (` D`), or any worktree-only change. It is a common scenario — open a file, edit it, and it becomes ` M` as the first entry.

**Fix:** Remove the `.trim()` call. Each individual line should be handled as-is. If leading blank lines need to be stripped, use `.replace(/^\s*\n/, '')` instead.

---

### Bug 2: `getOperationState` — `getConflictingFiles` uses wrong args prefix

**Severity: Medium**
**Lines:** `gitService.ts:279`

```typescript
const conflicts = inProgress ? await this.getConflictingFiles(workspacePath) : [];
```

`getConflictingFiles` calls `this.execGit(workspacePath, ['diff', '--name-only', '--diff-filter=U'])`. This works correctly in isolation, but when called from `getOperationState`, the response map in the test uses the prefix `'diff --name-only'` which also matches `'diff --name-only --diff-filter=U'`. This is not a bug in production (both commands produce the same output format), but the test response map is fragile — a prefix like `'diff --name-only'` could collide with other diff calls if the argument order changes.

No code fix needed, but worth noting for test maintenance.

---

### Bug 3: `getOperationState` does not detect cherry-pick in progress

**Severity: Low**
**Lines:** `gitService.ts:222–258`

The method checks `MERGE_HEAD` and `REBASE_HEAD` but not `CHERRY_PICK_HEAD`. During a cherry-pick with conflicts, the mode will be reported as `'none'` even though an operation is in progress and conflicts may exist.

**Fix:** Add a third check:

```typescript
try {
  await this.execGit(workspacePath, ['rev-parse', '--verify', 'CHERRY_PICK_HEAD']);
  mode = 'merge'; // cherry-pick uses merge-style abort
  inProgress = true;
  message = 'Cherry-pick in progress';
} catch { /* ... */ }
```

---

### Bug 4: `getHistory` — re-throws unhandled errors

**Severity: Medium**
**Lines:** `gitService.ts:379–393`

```typescript
} catch (error) {
  const errorText = String(...);
  if (errorText.includes('does not have any commits yet') || errorText.includes('unknown revision')) {
    return [];
  }
  throw error; // <-- re-throws
}
```

This is the **only method in GitService** that can throw an unhandled exception. Every other method returns an error result. The IPC handler in `main.ts` calls `gitService.getHistory(...)` without a try-catch, meaning an unexpected git error here will crash the handler and return an opaque error to the renderer.

**Fix:** Return `[]` for all errors, or return an error-shaped object consistent with other methods.

---

### Bug 5: `listStashes` — no error handling

**Severity: Medium**
**Lines:** `gitService.ts:312–322`

`listStashes` does not wrap its `execGit` call in a try-catch. If `git stash list` fails (e.g., corrupted repo, git binary missing), the exception propagates unhandled. The IPC handler in `main.ts` does not wrap it either.

Compare with every other method like `getHistory`, `getDiff`, `getBranchState` — they all catch errors and return a shaped error result.

**Fix:** Wrap in try-catch and return `[]` on failure (consistent with `getHistory`), or return an error-shaped result.

---

### Bug 6: `stage([])` — empty array triggers `add -A`

**Severity: Low**
**Lines:** `gitService.ts:596`

```typescript
const args = files && files.length > 0 ? ['add', '--', ...files] : ['add', '-A'];
```

If `stage('/workspace', [])` is called with an empty array, it falls through to `git add -A`, staging everything. This is arguably a bug — an empty array should be a no-op, not "stage everything."

**Fix:** Change the condition to `files && files.length > 0 ? ... : files === undefined ? ['add', '-A'] : []` to distinguish "no files specified" from "empty file list."

---

## Test Gaps

### Gap 1: No test for the `.trim()` bug on status parsing

The most critical implementation bug has no test. All existing status test data puts non-space characters first in the porcelain output, which avoids the trim bug entirely. The test suite is green despite the bug.

A test should use `' M file.txt\nA  staged.ts'` as the porcelain output and verify that the first change is correctly parsed as `{ path: 'file.txt', status: 'modified', staged: false }`.

---

### Gap 2: No test for `getBranches` format string accuracy

The test uses:

```typescript
addResponse('branch --format=%(refname:short)', { stdout: 'main\t*\nfeature\t \nbugfix\t ' })
```

But the actual implementation calls:

```typescript
['branch', '--format=%(refname:short)\t%(HEAD)']
```

The format string in the test prefix doesn't include `\t%(HEAD)`. The prefix match still works because `'branch --format=%(refname:short)'` is a prefix of the full `'branch --format=%(refname:short)\t%(HEAD)'`. This is fragile — if the format ever changes the order, the match breaks silently.

---

### Gap 3: No standalone test for `getConflictingFiles`

`getConflictingFiles` is a public method only tested indirectly through `getOperationState`. It should have its own tests verifying:
- Correct arg construction (`--diff-filter=U`)
- Empty conflict list
- Multiple conflict files

---

### Gap 4: No test for `getDiff('commit', ref)` with a short ref

The implementation does `commitRef.slice(0, 12)`. If the ref is shorter than 12 characters, `slice(0, 12)` returns the whole string. This edge case is not tested.

---

### Gap 5: No error test for `listStashes`

As noted in Bug 5, `listStashes` has no error handling. The test only covers successful parsing and empty output. No test verifies what happens when `git stash list` fails.

---

### Gap 6: No test for `getHistory` limit clamping

The implementation clamps `limit` to `Math.max(1, Math.min(50, limit))`. No test verifies:
- `limit = 0` (should clamp to 1)
- `limit = 100` (should clamp to 50)
- `limit = -1` (should clamp to 1)
- Default value (8)

---

### Gap 7: No test for `getHistory` when an unexpected error is re-thrown

Bug 4 means `getHistory` re-throws unhandled errors. No test verifies this behavior — the only error tests use recognized error strings that return `[]`.

---

### Gap 8: No test for `parseGitStatus` with renamed file paths

Renamed entries in porcelain format look like `R  old -> new`. The parser just does `line.slice(3).trim()` which produces `old -> new`. No test verifies this is the expected output or whether the consumer expects only the new path.

---

### Gap 9: No test for `stage([])` empty array edge case

As noted in Bug 6, calling `stage('/workspace', [])` stages everything. No test covers this.

---

### Gap 10: No test for concurrent polling restart

`startPolling` calls `this.stopPolling()` first to clean up any existing interval. No test verifies that calling `startPolling` twice with different paths stops the old polling and starts new polling correctly.

---

## Design Concerns

### Concern 1: `parseGitStatus` uses magic numbers instead of named constants

The code uses `line[0]`, `line[1]`, `line.slice(3)` directly. The porcelain format is `XY PATH` where positions are well-defined, but using named constants or destructuring would make the code self-documenting and less error-prone:

```typescript
const [indexStatus, workTreeStatus, _separator, ...pathParts] = line;
```

This would also prevent the trim bug from recurring.

### Concern 2: `parseBranchList` has redundant current-branch detection

```typescript
isCurrent: Boolean(currentBranch && name === currentBranch) || headMarker === '*',
```

This checks both the branch name comparison and the `*` HEAD marker. If these disagree (e.g., branch name changed between calls), the result is inconsistent. Since the HEAD marker is authoritative and comes from the same git call, the name comparison adds fragility.

### Concern 3: Error object shape inconsistency

Some methods return `{ success, error }` while `getHistory`, `listStashes`, `getBranches`, and `getConflictingFiles` throw or return raw results with no error wrapper. The IPC layer in `main.ts` expects different shapes for different handlers, which makes the error handling surface inconsistent and hard to reason about.

---

## Summary

| Category | Count | Most Critical |
|---|---|---|
| Implementation bugs | 6 | Bug 1 (trim corrupts status parsing) |
| Test gaps | 10 | Gap 1 (no test for the trim bug), Gap 5 (no listStashes error handling) |
| Design concerns | 3 | Concern 3 (inconsistent error shapes) |

**Recommended priority order:**

1. Fix Bug 1 immediately — it silently corrupts status parsing for a common scenario
2. Fix Bug 4 and Bug 5 — add error handling to `getHistory` and `listStashes`
3. Add tests for Gap 1 (the trim bug scenario) to prevent regression
4. Address Gap 9 (empty array → `add -A`) — decide intended behavior and test for it
5. Consider adding cherry-pick detection (Bug 3) and improving error shapes (Concern 3)
