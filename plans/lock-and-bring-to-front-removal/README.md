# Lock Pane & Bring-to-Front Removal

**Status:** Draft | In Review  
**Version:** 1.2  
**Author:** Jay  
**Date:** 2026-04-29

---

## Overview

This plan covers the removal of two undermaintained features from the Clanker Grid codebase:

1. **Lock Pane** — The `locked` field on panes was never fully enforced. GitHub issue #4 tracks this bug. Rather than fix all enforcement points, the team decided to remove the feature entirely.

2. **Bring-to-Front** (`bringPaneIntoView`) — This function predates the enhanced drop zones and workspace residency model. With `parked` workspaces now kept alive and visible, this function is no longer necessary.

---

## Plan Structure

```
plans/lock-and-bring-to-front-removal/
├── README.md          # This file
├── PLAN.md            # Detailed implementation plan
├── AGENT-PROMPT.md    # Agent execution directive
└── PROGRESS.md        # Phase tracking
```

---

## Quick Summary

| Item | Details |
|------|---------|
| **Why** | Lock pane enforcement was incomplete; bring-to-front predates current architecture |
| **Impact** | ~24 files affected (types, store, UI, layout helpers, tests, docs) |
| **Risk** | Low — no persistence, no external API, feature was not working correctly |
| **Rollback** | Git revert to last commit |

---

## Phase Overview

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 0 | Audit & Verification | ✅ Complete |
| Phase 1 | Type & Store Action Removal | 🔲 Not Started |
| Phase 2 | UI Component Lock & Bring-to-Front Removal (incl. Phase 2d — `canAddPane` call sites) | 🔲 Not Started |
| Phase 3 | Layout Helper Removal | 🔲 Not Started |
| Phase 4 | Test Cleanup | 🔲 Not Started |
| Phase 5 | Documentation & Invariants Update | 🔲 Not Started |
| Phase 6 | Validation | 🔲 Not Started |

---

## Files Affected

| File | Change |
|------|--------|
| `src/renderer/store/workspaceTypes.ts` | Remove `locked` field |
| `src/renderer/store/workspaceStoreTypes.ts` | Remove `bringPaneIntoView` type |
| `src/renderer/store/workspaceStore.ts` | Remove actions, lock guards |
| `src/renderer/store/workspaceLayout.ts` | Remove lock helpers |
| `src/renderer/components/TerminalPane.tsx` | Remove lock button, bringPaneIntoView |
| `src/renderer/components/BrowserPanel.tsx` | Remove lock button |
| `src/renderer/components/EditorPane.tsx` | Remove lock button |
| `src/renderer/components/DynamicPaneLayout.tsx` | Remove lock helpers |
| `src/renderer/components/Header.tsx` | Remove `canAddPane` selector and all usages |
| `src/renderer/components/FileExplorer/index.tsx` | Remove `canAddPane` guard |
| `src/renderer/store/INVARIANTS.md` | Update documentation |
| `tests/renderer/unit/workspaceLayout.test.ts` | Remove lock tests |
| `tests/renderer/integration/workspaceStore.test.ts` | Update fixtures |

---

## Related

- **GitHub Issue:** #4 — Bug: Lock icons on panes do not function - to be closed when plan complete.
