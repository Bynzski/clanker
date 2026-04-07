# AI Commit Message Implementation Plan

## Status

Implemented in the renderer, main process, preload bridge, and settings store.

## Goal

Add a small, unobtrusive commit-message helper to the existing Git commit dialog. When enabled, the helper can generate a commit message from the current repository state using one of the supported CLI harnesses and fill the result into the commit message field.

This feature should feel native to the current UI:

- A compact control in the commit dialog
- A small settings block in the cog menu
- No disruption to the existing manual commit flow

## Scope

### In scope

- Add a feature toggle to enable or disable AI commit message generation.
- Add settings to choose:
  - Provider / harness
  - Model
- Add a small button in the commit dialog to generate a commit message.
- Generate a commit message using a prepared prompt and the selected CLI.
- Fill the generated message into the existing commit message textarea.
- Persist the new settings across launches.

### Out of scope

- Auto-commit without user review.
- A full prompt editor.
- Per-workspace AI commit settings.
- Streaming token output in the UI.
- Multi-turn commit assistant sessions.

## Current Layout Fit

The existing UI already has the right separation of concerns:

- [`GitButton.tsx`](/home/jay/dev/projects/clanker-grid/src/renderer/components/GitButton.tsx) opens the commit modal.
- [`CommitDialog.tsx`](/home/jay/dev/projects/clanker-grid/src/renderer/components/CommitDialog.tsx) owns the commit message input and commit action.
- [`Header.tsx`](/home/jay/dev/projects/clanker-grid/src/renderer/components/Header.tsx) already exposes a cog dropdown for app settings.
- `electron-store` in [`src/main/main.ts`](/home/jay/dev/projects/clanker-grid/src/main/main.ts) already persists settings like `showFastfetch`.

This makes the commit helper a small extension, not a new subsystem.

## UX Proposal

### Commit dialog

Add a small button near the commit message label or aligned to the right of the label row.

Behavior:

- Visible only when the feature is enabled.
- Disabled while generation is in progress.
- On click, generates a message and fills the textarea.
- If generation fails, show an inline error in the dialog.

Suggested label styles:

- Icon-only button with a tooltip, or
- Compact icon + short label such as `Auto` or `Suggest`

The control should match the existing compact button language used in the app.

### Settings menu

Extend the cog dropdown in [`Header.tsx`](/home/jay/dev/projects/clanker-grid/src/renderer/components/Header.tsx) with a second section for AI commit settings.

Suggested controls:

- Checkbox: `Enable AI commit message`
- Provider selector: `Codex`, `OpenCode`, `Pi`
- Model selector: populated from the existing model discovery pipeline

If disabled:

- The commit dialog button is hidden or disabled
- The saved provider/model remain intact for later re-enabling

## Data Model

Add a new persistent settings shape in `electron-store`.

Recommended keys:

- `aiCommitEnabled: boolean`
- `aiCommitProvider: string`
- `aiCommitModel: string`

Optional future key:

- `aiCommitPromptTemplate: string`

Keep these separate from workspace state. The AI commit helper is app-wide behavior, while harness/model selection for launching workspaces is already workspace-specific.

## IPC / Main Process

Add a small settings API in the main process, similar to `showFastfetch`.

Suggested IPC methods:

- `get-ai-commit-settings`
- `set-ai-commit-enabled`
- `set-ai-commit-provider`
- `set-ai-commit-model`
- `generate-commit-message`

### `generate-commit-message`

This IPC handler should:

- Accept a workspace path
- Read the relevant git context
- Build a prompt
- Run the selected CLI with the selected model
- Return the generated text to the renderer

The handler should not commit anything. It only generates text.

## Prompt Strategy

Use the repository state as structured input rather than dumping the whole project.

Good prompt inputs:

- Current branch name
- Whether the repo is detached
- Staged diff
- Unstaged diff, if helpful
- Optional short file list from the current commit scope

Recommended default behavior:

- Prefer staged diff if there are staged changes.
- Otherwise use the working tree diff as context.
- Ask for a single commit message line, or a short conventional commit subject.

Suggested output constraint:

- Return only the message text.
- Strip markdown fences, prefixed labels, and surrounding quotes if the CLI returns them.

## Provider / Model Selection

Reuse the model discovery work already implemented for harness selection.

Recommended mapping:

- `codex` uses the current Codex model list and documented model names
- `opencode` uses `opencode models`
- `pi` uses `pi --list-models`

The AI commit helper should reuse these sources rather than inventing a separate discovery path.

Important constraint:

- Only show models that the selected provider can actually run.
- If no models are available for a provider, disable the provider or show an empty state instead of fake fallbacks.

## Implementation Phases

### Phase 1: Settings plumbing

- Add AI commit settings to `electron-store`.
- Expose getter/setter IPC in preload and renderer typings.
- Add types for the settings object in the renderer.

### Phase 2: Settings UI

- Extend the cog menu with an AI commit section.
- Add toggle and provider/model selectors.
- Reuse the current dropdown styling so the control stays compact.

### Phase 3: Commit dialog button

- Add a small helper button near the commit message input.
- Wire the button to the new generation IPC.
- Fill the textarea with the returned text.
- Show loading and error state.

### Phase 4: Prompt runner

- Implement the main-process generator.
- Build the prompt from git status and diff data.
- Call the chosen CLI with the selected model.
- Parse the output into a plain commit message.

### Phase 5: Hardening

- Add smoke tests for prompt assembly and CLI argument generation.
- Verify the dialog still supports manual entry and stage-all flows.
- Verify the helper respects disabled state and missing models.

## UI Placement Notes

The requested placement should stay small and fit the existing controls:

- In [`CommitDialog.tsx`](/home/jay/dev/projects/clanker-grid/src/renderer/components/CommitDialog.tsx), place the helper button near the commit label or in the same row as the textarea header.
- In [`Header.tsx`](/home/jay/dev/projects/clanker-grid/src/renderer/components/Header.tsx), add the AI settings inside the existing cog dropdown rather than creating a new settings surface.

This avoids visual clutter and keeps the feature discoverable without dominating the dialog.

## Risks / Tradeoffs

- The CLI may return verbose or formatted output instead of a clean message.
- Model discovery differs by provider, so a provider can be available while a model list is empty.
- If the prompt is too broad, commit messages may become generic.
- If the helper runs on unstaged diffs only, it may miss the user’s intended scope.

Recommended mitigation:

- Keep the prompt short and structured.
- Use staged diff first when available.
- Allow the user to edit the generated text before commit.
- Keep the generated output one line by default.

## Acceptance Criteria

- A new toggle appears in the cog menu to enable or disable AI commit assistance.
- The user can choose provider and model from the available CLI model lists.
- The commit dialog shows a small helper button when enabled.
- Clicking the button fills the commit message field.
- Existing manual commit behavior still works unchanged.
- Settings persist across restarts.
- No fake models are shown for providers that do not report any available models.

## Suggested File Touchpoints

- [`src/main/main.ts`](/home/jay/dev/projects/clanker-grid/src/main/main.ts)
- [`src/main/preload.ts`](/home/jay/dev/projects/clanker-grid/src/main/preload.ts)
- [`src/renderer/electron.d.ts`](/home/jay/dev/projects/clanker-grid/src/renderer/electron.d.ts)
- [`src/renderer/components/Header.tsx`](/home/jay/dev/projects/clanker-grid/src/renderer/components/Header.tsx)
- [`src/renderer/components/Header.css`](/home/jay/dev/projects/clanker-grid/src/renderer/components/Header.css)
- [`src/renderer/components/CommitDialog.tsx`](/home/jay/dev/projects/clanker-grid/src/renderer/components/CommitDialog.tsx)
- [`src/renderer/components/GitButton.css`](/home/jay/dev/projects/clanker-grid/src/renderer/components/GitButton.css)
- [`src/renderer/store/workspaceStore.ts`](/home/jay/dev/projects/clanker-grid/src/renderer/store/workspaceStore.ts)

## Implemented Behavior

- Settings are stored in `electron-store` as app-wide preferences.
- The cog menu now exposes AI commit generation controls.
- The commit modal includes a compact generate button when the feature is enabled.
- The generator uses the selected CLI, current repo branch, the current diff summary, and a concise change list.
- The returned text is normalized before it fills the commit message field.
- The prompt asks for a single conventional-style subject line beginning with `feature:`, `fix:`, `restructure:`, or `chore:`.
- `opencode` gets a longer timeout than the other providers because it is slower to return on some machines.
- Only the documented local CLIs are used for AI commit generation: `codex`, `opencode`, and `pi`.
