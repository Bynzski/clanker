# Model Picker Implementation

## Overview

Clanker Grid now supports selecting a model when launching a harness from the workspace gate. The selected model is stored with the active workspace so later terminals spawned from that workspace reuse the same harness/model pairing.

## What Changed

### Main Process

- Added `modelArg` to harness configuration in [`src/main/main.ts`](/home/jay/dev/projects/clanker-grid/src/main/main.ts).
- Added best-effort model discovery via a new IPC handler, `get-harness-models`.
- `opencode` uses `opencode models` with a temporary data directory so the command can run even when the user's home data path is read-only.
- `pi` uses `pi --list-models` against the user's actual local environment and parses the table output into `provider/model` values. If the command reports that no models are available, the picker stays empty instead of inventing fallback models.
- `codex` uses the documented current Codex model set and falls back to the configured default model from `~/.codex/config.toml`.
- `claude` still falls back to curated defaults because it does not expose a stable model listing command here.
- Harness terminals are now spawned directly with argv instead of typing a command into an interactive shell, so the selected model flag is passed as a real process argument.

### Renderer

- Added model state to the workspace gate form in [`src/renderer/components/WorkspaceGateContent.tsx`](/home/jay/dev/projects/clanker-grid/src/renderer/components/WorkspaceGateContent.tsx).
- Replaced the earlier plain-select idea with a compact dropdown/popover that matches the app's pill/button styling.
- Wired the selected model through [`WorkspaceGate.tsx`](/home/jay/dev/projects/clanker-grid/src/renderer/components/WorkspaceGate.tsx) and [`App.tsx`](/home/jay/dev/projects/clanker-grid/src/renderer/App.tsx).
- Added `model` to workspace state in [`src/renderer/store/workspaceStore.ts`](/home/jay/dev/projects/clanker-grid/src/renderer/store/workspaceStore.ts) so later `New Terminal` actions use the same selection.
- Updated [`src/renderer/components/Header.tsx`](/home/jay/dev/projects/clanker-grid/src/renderer/components/Header.tsx) so new terminals inherit the active workspace model.
- Updated preload and renderer IPC types in [`src/main/preload.ts`](/home/jay/dev/projects/clanker-grid/src/main/preload.ts) and [`src/renderer/electron.d.ts`](/home/jay/dev/projects/clanker-grid/src/renderer/electron.d.ts).

## Model Discovery Strategy

The picker is intentionally best-effort:

- `opencode` runs `opencode models`
- `pi` runs `pi --list-models` in the user's current environment
- `codex` uses the documented current Codex model set and the configured default model
- `claude` uses curated defaults

This keeps the UI responsive and avoids depending on unstable help text parsing for tools that do not expose a stable model-list command.

## UX Notes

- The model picker only appears when a harness is selected.
- Changing harness clears the previous model selection.
- The picker defaults to `Default model`, which means the harness chooses its own default behavior.
- The control is styled as a compact in-app popover rather than a native `<select>`, so it fits the existing gate/header aesthetic.

## Files Updated

- [`src/main/main.ts`](/home/jay/dev/projects/clanker-grid/src/main/main.ts)
- [`src/main/preload.ts`](/home/jay/dev/projects/clanker-grid/src/main/preload.ts)
- [`src/renderer/electron.d.ts`](/home/jay/dev/projects/clanker-grid/src/renderer/electron.d.ts)
- [`src/renderer/store/workspaceStore.ts`](/home/jay/dev/projects/clanker-grid/src/renderer/store/workspaceStore.ts)
- [`src/renderer/App.tsx`](/home/jay/dev/projects/clanker-grid/src/renderer/App.tsx)
- [`src/renderer/components/Header.tsx`](/home/jay/dev/projects/clanker-grid/src/renderer/components/Header.tsx)
- [`src/renderer/components/WorkspaceGate.tsx`](/home/jay/dev/projects/clanker-grid/src/renderer/components/WorkspaceGate.tsx)
- [`src/renderer/components/WorkspaceGateContent.tsx`](/home/jay/dev/projects/clanker-grid/src/renderer/components/WorkspaceGateContent.tsx)
- [`src/renderer/components/WorkspaceGate.css`](/home/jay/dev/projects/clanker-grid/src/renderer/components/WorkspaceGate.css)

## Verification

- `npm run build` completed successfully after the changes.

## Follow-Up Ideas

- Add a search field inside the model popover for larger model lists.
- Persist the last selected model per harness if you want the picker to remember user preference across launches.
- Surface the active model in the header or status bar for easier workspace inspection.
