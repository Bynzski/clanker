# Fallow maintenance checks

Use the lockfile-installed Fallow version (currently 2.56.0):

```bash
npm ci
npm run fallow:report
npm run fallow:report:production
npm run fallow:check             # both gates, including stale exemptions
npm run fallow:check:full        # optional: full graph only
npm run fallow:check:production  # optional: production graph only
```

The report commands emit JSON and retain all findings. Production mode excludes tests/development files; its estimated coverage/CRAP scores are not comparable to the full scan's. Neither command supplies measured coverage.

## Identity regression and stale-exemption policy

`fallow:check` runs **two uncached dead-code scans** through `scripts/check-fallow.cjs`:

- Full graph: `docs/evidence/fallow-dead-code-baseline.json`.
- Production graph: `docs/evidence/fallow-production-dead-code-baseline.json`.

Both run in `npm run validate` and Ubuntu CI. Baseline-only changes also require Ubuntu validation: these JSON files are executable policy, not ordinary documentation.

Each scan saves Fallow's native issue identities to a private temporary directory, compares them with the committed baseline, and removes the temporary output. It never rewrites a committed baseline. New identities **and stale exemptions** fail, independently in each mode. This preserves category/path/export identity rather than comparing counts or source line numbers: fixing one old finding cannot buy permission for an unrelated new finding. The production gate catches files/exports kept reachable only by tests even when the full graph passes. Empty categories are checked too; no category's findings are silently accepted.

Exit 1 is expected when a successful Fallow scan has findings. The wrapper accepts it only with a valid schema-4 JSON report and a valid saved identity snapshot; spawn failures, timeouts, malformed output/baselines and unexpected statuses fail closed. Recheck this compatibility contract on Fallow upgrades. Fallow 2.56's count-regression flag is not used.

When code resolves a finding, remove that exact identity from the affected baseline(s) in the same PR. A retained export gaining a production caller requires removing its production exemption even if tests already used it. Do not automatically refresh baselines in CI, or accept every production finding merely to make a new gate pass.

For a deliberately reviewed snapshot, save **outside the committed baseline** first:

```bash
npx --no-install fallow dead-code --no-cache --save-baseline /tmp/fallow-full-reviewed.json
npx --no-install fallow dead-code --no-cache --production --save-baseline /tmp/fallow-production-reviewed.json
```

These commands may exit 1 because existing findings remain. Review every difference, document newly accepted identities, and edit the committed baselines explicitly. Do not ignore arbitrary command failures. Use an appropriate temporary path on Windows.

## Reviewed backlog and #174 cleanup

The original full baseline came from the targeted 2026-10-07 cleanup at `f063195`: 2 unused test helpers, 18 value exports and 37 type exports. Issue #174 confirmed 11 stale type identities; those exemptions are now removed. Fifteen unused source value exports were removed or made module-private (including unused branding re-exports and the unused keybinding predicate). Canonical branding assets are retained for packaging.

The four retired launcher surfaces (`WorktreeLauncher`, `RemoteWorktreePicker`, `RemoteWorktreeCreate`, `RemoteWorktreeInspect`) and the unused `useKeepInViewport` hook had no live application callers. They and their dedicated tests are removed. Surviving Git/SSH worktree authority tests are retained. The Git menu uses the shared Popover's collision handling, not that hook. Also removed: the selected-agent worktree convenience function, unused layout gap/first-leaf helpers and gap type, the redundant store re-export of `getEdgeTerminals`, and two shared path-classification helpers with no runtime callers. The live UNC classifier and platform-specific browser/security validators remain intact. Integration tests use surviving checkout/layout APIs directly; live layout insertion/removal logic remains intact.

Fresh post-cleanup dead-code findings:

| Mode | Unused files | Value exports | Type exports | Total |
| --- | ---: | ---: | ---: | ---: |
| Full | 2 | 3 | 25 | 30 |
| Production | 0 | 40 | 25 | 65 |

The full baseline only shrank; no new full-scan findings were accepted. Its remaining test helpers and type exports are the existing cleanup backlog, not proof that deletion is safe. The 25 production type identities are exactly that same remaining full-scan type backlog (local state/DTO types and legacy type re-exports); no extra type findings were accepted. Type API cleanup remains a separate candidate review, not runtime reachability evidence.

### Reviewed production value exports

The following is the complete reviewed inventory of the 40 remaining production value findings, grouped by module. Most are **exports for focused tests of internally live behavior**, not dead implementations. Two reset helpers deliberately exist only for test isolation. Keep these narrow identities, not blanket source/test exclusions. The primitive aliases are a documented compositional API exercised by accessibility/focus tests. Contract inventories are intentional validation seams.

Paths below are relative to `src/renderer/`, except those beginning `shared/` (relative to `src/`).

| Module | Accepted exports | Review rationale / test evidence |
| --- | --- | --- |
| `components/ChatHistoryDropdown.tsx` | `sessionCheckoutLabel` | Live label helper; `sessionCheckoutLabel.test.ts` covers removed-checkout history. |
| `components/FileExplorer/FileTree.tsx` | `toRelativePath` | Live tree path helper; `FileExplorer/FileTree.test.ts`. |
| `components/RemoteDirectoryChooser.tsx` | `getPathCrumbs`, `resolveTypedPath` | Live remote path navigation; `RemoteDirectoryChooser.test.tsx`. |
| `components/WorkspaceRail.tsx` | `getWorkspaceMonogram` | Live label helper; `WorkspaceRail.test.tsx`. |
| `components/ui/{AlertDialog,Dialog,Popover}.tsx` | `AlertDialogTrigger`, `DialogTrigger`, `PopoverClose` | Documented shared composition API; `Dialog.test.tsx` / `Popover.test.tsx` verify nested focus, dismissal and leases. Current features use controlled dialogs or automatic Popover dismissal. |
| `components/useBrowserBoundsLifecycle.ts` | `browserBoundsFromDomRect` | Live bounds conversion; `browserBounds.test.ts` and sidebar-contract tests. |
| `components/useHarnessUsage.ts`, `store/usageStore.ts` | `USAGE_POLL_INTERVAL_MS` (both identities) | Live polling interval plus compatibility re-export used by usage/header tests. |
| `lib/activeDestination.ts` | `resolveActiveBrowserOwner` | Internally used owner resolution; `AssistantDestination.test.tsx`. |
| `lib/agentNames.ts` | `AGENT_NAMES`, `RECENT_NAME_LIMIT`, `pickAgentName`, `resetRecentAgentNames` | Live naming data/selection plus deliberate test-only history reset; `agentAttention.test.ts`. |
| `lib/attentionDiagnostics.ts` | `explainTerminalAttention` | Exposed by the live developer diagnostics API; direct contract checks in `attentionDiagnostics.test.ts`. |
| `lib/editorKeymap.ts` | `EDITOR_BASELINE_BINDINGS` | Live editor keymap data; `editorKeymap.test.ts` checks precedence. |
| `lib/emailMask.ts` | `maskEmailAddress` | Internally used redaction; `emailMask.test.ts`. |
| `lib/idleWarmup.ts` | `WARMUP_DELAY_MS` | Live warmup delay; history/usage timing tests. |
| `lib/keybindingDispatcher.ts` | `getEventContext` | Internally used event routing; `keybindingDispatcher.test.ts`. |
| `lib/linkUtils.ts` | `resolveTerminalFilePath` | Internally used path confinement; `linkUtils.test.ts`. |
| `lib/openWorkspaceStorage.ts` | `OPEN_WORKSPACES_STORAGE_KEY`, `parseOpenWorkspaceState` | Live persistence format; `workspaceShells.test.ts` and real-open integration tests. |
| `lib/terminalRuntimeCache.ts` | `clearTerminalCache` | Deliberate test-only reset of renderer singleton terminals/tombstones; TerminalPane, page and bridge test isolation. Runtime eviction uses per-terminal disposal. |
| `lib/usageFormat.ts` | `measurementLabel` | Live usage formatting; `usageFormat.test.ts`. |
| `lib/workspaceLifecycle.ts` | `terminateWorkspaceTerminals` | Live resource disposal helper; lifecycle and main terminal-cleanup tests. |
| `lib/workspacePageStorage.ts` | `parseWorkspacePages`, `restoreWorkspacePages` | Live page restoration; `workspacePageStorage.test.ts`. |
| `lib/workspaceWarmth.ts` | `MAX_WARM_WORKSPACE_SURFACES` | Live bounded surface cache; warmth/WorkspaceHost tests. |
| `store/notificationStore.ts` | `NOTIFICATION_HISTORY_LIMIT` | Live bounded notification history; `notificationStore.test.tsx`. |
| `store/workspaceLayout.ts` | `getEdgeTerminals` | Internally used insertion geometry; layout unit and store integration tests. |
| `store/workspaceStoreHelpers.ts` | `generatePaneId`, `DEFAULT_RESOURCE_POLICY`, `sanitizeRuntimeState` | Internally used IDs/defaults/sanitization; `workspaceStoreHelpers.test.ts`. |
| `shared/harnessDescriptors.ts` | `AGENT_BRIDGE_HARNESS_IDS` | Capability inventory validation seam; `agentBridgeProviders.test.ts` checks descriptor/provider agreement. |
| `shared/ipcChannels.ts` | `ALL_IPC_CHANNELS` | IPC registration inventory validation seam; IPC registration/channel/account tests. |
| `shared/keybindings.ts` | `KEYBINDING_COMMAND_IDS`, `getDefaultBinding`, `contextsOverlap` | Internally used keybinding inventory/default/conflict logic; `keybindings.test.ts`. |

## Narrow compatibility exceptions

`.fallowrc.json` declares standalone smoke/experiment scripts as explicit entries where needed. Its script-scoped unresolved-import overrides cover scripts loading generated `dist/main` modules. Consult the exact entry/override lists in that file rather than a historical script count. This does not mean Fallow or validation executed those scripts.

`@modelcontextprotocol/sdk` is directly used by `src/main/agentBridge/server.ts`, and its imported subpaths resolve in Node and TypeScript. Fallow 2.56 misclassifies those subpaths and consequently reports the package unused. Dependency-ignore applies to that exact package; unresolved-import checking is disabled only for that server file. Recheck these exceptions on a Fallow upgrade. Build/typecheck remain responsible for detecting broken imports there.

`node:sqlite` is a Node builtin, not an installable missing dependency; it is ignored by exact dependency name. The existing renderer declaration-file unresolved-import override is retained.

No broad source exclusion, global unresolved-import disabling, complexity suppression, or dependency removal was introduced. Architecture boundary rules remain unconfigured; a zero boundary count is not architectural proof.

Historical repository measurements and completed cleanup reports remain in Git history. Use fresh report output, not old grades or test counts, when assessing the current tree.
