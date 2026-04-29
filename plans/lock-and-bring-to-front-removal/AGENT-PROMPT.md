# Lock Pane & Bring-to-Front Removal — Agent Prompt

**Plan Path:** `plans/lock-and-bring-to-front-removal/`

---

## Context

The team has decided to remove two undermaintained features:
1. **Lock Pane** — The `locked` field on panes was never fully enforced. Rather than fix all enforcement points, we remove the feature entirely.
2. **Bring-to-Front** (`bringPaneIntoView`) — No longer necessary with the workspace residency model.

---

## Execution Instructions

### Before Starting

1. Read `PLAN.md` completely
2. Read `PROGRESS.md` to determine the next phase
3. Read `AGENTS.md` for architecture rules and constraints
4. **Pay special attention to Phase 2d** — it removes `canAddPane` call sites from `Header.tsx` and `FileExplorer/index.tsx`. These call sites must be removed when the action is removed, or the app will crash at runtime with `canAddPane is not a function`.

### Phase Execution

Execute each phase sequentially:
1. Phase 1: Type & Store Action Removal (includes new Phase 1e for `workspaceStoreHelpers.ts` cleanup — critical, must be done before typecheck)
2. Phase 2: UI Component Lock & Bring-to-Front Removal
3. Phase 3: Layout Helper Removal
4. Phase 4: Test Cleanup
5. Phase 5: Documentation & Invariants Update
6. Phase 6: Validation

### Per Phase

1. Read the phase details in `PLAN.md`
2. Read the relevant source files
3. Make the changes described
4. Run `npm run validate` after each phase
5. Commit with the commit format:
   ```
   refactor(<scope>): phase <N> — <description>

   - bullet list of changes

   Phase <N> of plans/lock-and-bring-to-front-removal/PLAN.md
   ```
6. Update `PROGRESS.md` to mark the phase as ✅

### Important Constraints

- **Phase 1e is critical:** Before running `npm run typecheck`, Phase 1e must be complete. Skipping the `locked` assignment cleanup in `workspaceStoreHelpers.ts` will cause TypeScript compilation errors even after the types are updated.
- **Phase 1 ordering:** Complete Phase 1a → 1e in sequence. Do not skip Phase 1e even if it feels like a "small cleanup" step.
- **`hasUnlockedLeaf` import removal:** The import in `workspaceStore.ts` is removed in Phase 1d, not Phase 1c. Phase 1c removes the function definition only; the import stays until Phase 1d (when the lock guards that use it are also removed).
- **No regression:** All `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run test` must pass
- **No dead code:** When removing features, ensure all related code is removed
- **POSIX paths:** Paths crossing IPC use forward slashes
- **No bare `npm test`:** Always use `npm run test` or `npm run validate`
- **Main/renderer separation:** System resources in main, UI in renderer

### Rollback

If a phase fails validation, revert to the last commit and report the issue.

---

## Plan Location

```
plans/lock-and-bring-to-front-removal/
├── README.md
├── PLAN.md
├── AGENT-PROMPT.md
└── PROGRESS.md
```
