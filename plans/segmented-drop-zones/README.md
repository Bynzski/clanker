# Segmented Edge Drop Zones

## Status

**Draft** — Plan updated 2026-04-23 (v1.2 with second gap analysis review), awaiting review and approval.

## Summary

Replace the four monolithic edge drop zones with segmented zones that reflect the actual terminal layout along each edge. Up to 4 gap zones per edge (between edge terminals) plus a full-edge zone in the center.

## Documents

| File | Purpose |
|------|---------|
| [PLAN.md](./PLAN.md) | Full implementation plan with phase details |
| [PROGRESS.md](./PROGRESS.md) | Phase tracking and status |
| [AGENT-PROMPT.md](./AGENT-PROMPT.md) | Agent execution directive |
| [CHECKLIST.md](./CHECKLIST.md) | Quality review checklist |
| [GAP-ANALYSIS.md](./GAP-ANALYSIS.md) | Gap analysis (16 items resolved in v1.1, 12 new gaps + 5 minor in v1.2) |

## Phase Order

| Phase | Description |
|-------|-------------|
| 0 | Edge terminal detection (pure functions + tests) |
| 1 | Edge gap insertion mutation (pure function + tests) |
| 2 | Dynamic segmented DockEdgeTargets component |
| 3 | Store integration + DnD wiring |
| 4 | CSS polish, transitions, edge cases |
| 5 | Validation and final testing |

## Version

1.2 — Second gap analysis + plan corrections (2026-04-23)
