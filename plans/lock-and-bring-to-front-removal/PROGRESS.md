# Lock Pane & Bring-to-Front Removal — Progress

**Plan:** Lock Pane & Bring-to-Front Removal  
**Author:** Jay  
**Date:** 2026-04-29  
**Version:** 1.1

---

## Phase Status

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 0 | Audit & Verification | ✅ Complete |
| Phase 1a | Remove `locked` from types (`workspaceTypes.ts`) | 🔲 Not Started |
| Phase 1b | Remove bring-to-front and `canAddPane` types (`workspaceStoreTypes.ts`) | 🔲 Not Started |
| Phase 1c | Remove lock helpers from `workspaceLayout.ts` | 🔲 Not Started |
| Phase 1d | Remove lock actions, guards, `locked` spreads (`workspaceStore.ts`) | 🔲 Not Started |
| Phase 1e | Clean `locked` assignments (`workspaceStoreHelpers.ts`) | 🔲 Not Started |
| Phase 2 | UI Component Lock & Bring-to-Front Removal | 🔲 Not Started |
| Phase 3 | Layout Helper Removal | 🔲 Not Started |
| Phase 4 | Test Cleanup | 🔲 Not Started |
| Phase 5 | Documentation & Invariants Update | 🔲 Not Started |
| Phase 6 | Validation | 🔲 Not Started |

---

## Phase 0: Audit & Verification ✅

**Completed:**
- ✅ Confirmed lock feature inventory across types, store, UI, layout helpers
- ✅ Confirmed `bringPaneIntoView` and `bringBrowserIntoView` inventory
- ✅ Identified dead code that will be removed
- ✅ Identified `workspaceStoreHelpers.ts` and `workspaceStore.ts` `locked` assignments that must be cleaned (causes TS errors if skipped)
- ✅ Identified `canAddPane` and `bringBrowserIntoView` that must be removed alongside `bringPaneIntoView`

**Key Findings:**
- Lock feature: 3 types with `locked` field, 3 toggle actions, lock guards in 3 store functions, lock buttons in 3 UI components, lock helpers in 2 layout modules
- Lock assignments in helpers: `createDefaultBrowserPane`, `sanitizeBrowserPane`, `sanitizeWorkspace`
- Lock spreads in store: `updateBrowserPosition` (~line 1052), `toggleBrowser` (~lines 475, 481), `openFileInEditor` (~line 1449), `toggleEditorPane` (~line 1664)
- `bringPaneIntoView`: 1 store action (line 1140), 1 usage in `TerminalPane.tsx`
- `bringBrowserIntoView`: sibling action to `bringPaneIntoView` (line 1171), used in `BrowserPanel.tsx`, also to be removed
- `bringEditorIntoView`: editor pane equivalent (line ~1754), no UI button; to be removed
- `canAddPane`: uses `hasUnlockedLeaf`, only purpose was to gate lock guards — to be removed
- `canAddPane` call sites: `Header.tsx` (selector + guard + disabled attr) and `FileExplorer/index.tsx` (guard) — **must be removed alongside the action or runtime errors result**
- Total files affected: ~24 files across types, store, UI components, layout helpers, tests, documentation

---

## Next Phase

**Phase 1:** Type & Store Action Removal

Start with Phase 1a: remove the `locked` field from `Pane`, `BrowserPaneState`, and `EditorPaneState` in `workspaceTypes.ts`.

**Critical note:** After Phase 1a, complete Phase 1e (clean `workspaceStoreHelpers.ts`) before running any typecheck. Skipping Phase 1e causes TypeScript errors.

---

## Notes

- **Version 1.1 changes:** Code review found 4 critical gaps: (1) `workspaceStoreHelpers.ts` `locked` assignments missed, (2) `workspaceStore.ts` `locked` spreads in `updateBrowserPosition`/`toggleBrowser` missed, (3) `canAddPane` not addressed, (4) `bringBrowserIntoView` not listed. Phase 1e added. `bringBrowserIntoView` added to removal list.
- The existing `lock-pane-enforcement` plan (for issue #4) is now obsolete given this removal decision
- Consider archiving or removing the `lock-pane-enforcement` plan folder after this plan is complete
