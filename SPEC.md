# Clanker Grid Specification

## Document Status

Date: 2026-04-07
Repository: `clanker-grid`
Status: Current-state product and implementation specification

This document describes the application as it exists in the repository today. It replaces the earlier launcher-era spec that no longer matched the current app.

## Product Summary

Clanker Grid is an Electron desktop workspace manager for software development. It combines:

- Multiple named workspace tabs
- Terminal panes backed by PTY processes
- Optional AI coding harness launches per workspace
- An embedded native browser panel
- Git status, history, stash, branch, merge, and commit workflows
- Optional AI-assisted commit message generation

The application is optimized around keeping repository work, CLI sessions, and browser context in one window while preserving per-workspace state.

## Primary Use Cases

- Open one or more local repositories in separate workspace tabs
- Launch plain shell terminals or AI harness sessions in those workspaces
- Rearrange terminal and browser panes into a working layout
- Inspect and manage git state without leaving the app
- Generate commit messages from repository state through supported AI CLIs

## Current Technical Stack

- Shell: Electron 41.x
- Renderer: React 19 + TypeScript + Vite
- State management: Zustand
- Terminal runtime: `node-pty` + `@xterm/xterm`
- Layout engine: custom pane tree with `react-resizable-panels` and `@dnd-kit/core`
- Persistence: `electron-store` for app settings and last workspace defaults

## Application Model

### Window Model

- Single frameless desktop window
- Custom title bar with window controls
- Native embedded browser surface via `WebContentsView`
- Minimum window size: 800x600
- Default window size: 1200x800

### Workspace Model

Each workspace tab stores:

- Display name
- Local workspace path
- Selected harness
- Selected harness model
- Terminal list
- Pane list
- Browser visibility state
- Browser URL
- Browser pane state
- Active terminal id
- Layout tree

The renderer store mirrors the active workspace at the top level for convenience while also retaining the full `workspaces[]` collection.

### Terminal Model

Each terminal is backed by a real PTY process created in the Electron main process. A terminal may be:

- A plain interactive shell
- A harness-specific process such as Codex, Claude, OpenCode, or Pi

Terminal output is streamed through IPC into xterm.js.

### Pane Model

The visible layout is represented as a tree of:

- Leaf nodes that point at pane ids
- Split nodes with orientation and ratio

Visible panes may correspond to:

- Terminal panes
- The browser pane when enabled

Panes can be:

- Resized
- Swapped
- Docked to an edge
- Locked against insert/reflow operations
- Brought into view by swapping with the first visible leaf

## User Experience

### Launch Experience

If no workspaces exist, the app opens into a fullscreen workspace gate. The gate supports:

- Typing or browsing to a local directory
- Directory autocomplete based on filesystem reads
- Terminal count presets: 1, 2, or 4
- Harness selection from only the CLIs available on the machine
- Optional model selection for harnesses that expose models

The initial default harness is `codex` when available.

### Main Workspace Experience

Once at least one workspace exists, the application shows:

- Custom title bar with workspace tabs
- Header toolbar with workspace controls
- Main pane layout region
- Status bar

### Workspace Tabs

Tabs support:

- Selecting the active workspace
- Inline rename
- Close with terminal shutdown
- Per-tab terminal count badge

### Header Controls

The header currently includes:

- Open Workspace
- Harness selection pills
- New Terminal
- Fit All Panes
- Show/Hide Browser
- Close Workspace
- Git button with status count and git menu
- Settings menu

### Status Bar

The status bar shows:

- Current terminal count
- Current workspace path
- Static ready indicator

## Functional Areas

### Workspace Creation and Persistence

When the user launches a workspace:

- The chosen path is normalized with a trailing slash in the renderer
- The main process validates directory existence before using it
- Terminal processes are spawned in that directory
- A workspace tab is added with its own layout and terminal list

Persisted settings currently include:

- Last workspace path
- Whether fastfetch suppression is enabled
- AI commit enabled/disabled
- AI commit provider
- AI commit model

### Harness Selection

Supported harness ids in the current product:

- `''` for plain terminal
- `codex`
- `claude`
- `opencode`
- `pi`

Only harnesses whose CLI command is available on the local machine are shown as selectable.

Model lists are resolved dynamically through the main process. Fallback model lists exist for some providers when discovery fails.

### Terminal Lifecycle

The main process provides IPC for:

- Spawn terminal
- Read buffered output
- Write input
- Resize terminal
- Kill terminal
- Terminal data stream subscription
- Terminal exit subscription

Renderer behavior:

- xterm is lazy-loaded only when a terminal pane initializes
- Terminal pane sizing is synchronized back to the PTY
- Existing buffered output is replayed before live stream subscription

### Pane and Layout Behavior

The layout system supports:

- Recursive split layouts
- Drag and drop between panes
- Edge docking targets
- Fit/reset to balanced layout
- Browser insertion/removal from the layout tree
- Lock-aware insertion that avoids modifying locked leaves where possible

If all visible leaves are locked, new pane insertion is blocked and the app logs a warning.

### Browser Panel

The browser panel is a native `WebContentsView` managed by the main process. Renderer responsibilities are limited to toolbar state and bounds calculation.

Supported browser actions:

- Navigate to URL
- Back
- Forward
- Refresh
- Stop
- Open in external browser
- Bring browser pane into view
- Lock/unlock browser pane

Security constraints currently enforced:

- Embedded browser navigation limited to `http:` and `https:`
- External open limited to `http:`, `https:`, and `mailto:`
- New windows denied and redirected through the system browser when allowed
- Electron sandbox enabled for the app window and browser view

### Git Integration

Git features are exposed through the main process `GitService` and surfaced in the header git menu.

Current git capabilities:

- Polling and live status updates
- Branch state and detached HEAD handling
- Working tree and staged status listing
- Stage all or selected files through service IPC
- Commit creation with explicit commit message
- Branch create, switch, delete
- Merge and abort operation
- Operation-state reporting for merge/rebase in progress
- Stash list, create, apply, pop, drop, clear
- History list
- Working, staged, and commit diff summaries

The git menu is split into focused renderer sections:

- Branches
- Merge
- Stashes
- History

### Commit Dialog

The commit dialog supports:

- Manual commit message entry
- Stage All
- Stage All & Commit when unstaged changes exist
- File list with staged indicators
- Error surface for failed git actions

### AI Commit Message Generation

The commit dialog can optionally generate a commit message from repository state if enabled in settings.

Current flow:

- Main process inspects git status and diff summary
- A provider-specific prompt is built
- A supported CLI is executed with the prompt over stdin
- The output is normalized into a single commit message
- The message is inserted into the dialog text area

Current AI commit providers:

- `codex`
- `opencode`
- `pi`

The provider and model are configured globally in the header settings menu.

## Main Process Responsibilities

The Electron main process currently owns:

- Window lifecycle
- Browser `WebContentsView` lifecycle
- PTY process management
- Local settings persistence
- Harness availability and model discovery
- Git operations and polling
- AI commit generation orchestration
- Renderer IPC surface

Notable extracted modules:

- `src/main/gitService.ts`
- `src/main/harnessCatalog.ts`
- `src/main/harnessLaunch.ts`
- `src/main/aiCommit.ts`
- `src/main/security.ts`

## Renderer Responsibilities

The renderer currently owns:

- Workspace gate and launch UX
- Workspace tab UX
- Pane layout rendering and drag/drop
- Terminal pane rendering and xterm lifecycle
- Browser toolbar UX
- Settings UI
- Git menu and commit dialog UX
- Active workspace state and layout state in Zustand

Notable renderer modules:

- `src/renderer/store/workspaceStore.ts`
- `src/renderer/store/workspaceLayout.ts`
- `src/renderer/store/workspaceTypes.ts`
- `src/renderer/components/DynamicPaneLayout.tsx`
- `src/renderer/components/TerminalPane.tsx`
- `src/renderer/components/GitButton.tsx`

## Security and Validation Constraints

Current constraints and hardening measures:

- Main-process directory arguments are validated before use
- Browser URL schemes are restricted
- External URL schemes are restricted
- Git commit and staging use argument-safe git invocation
- Electron renderer sandbox is enabled
- Context isolation is enabled
- Renderer communicates only through the preload bridge

Current validation gates:

- `npm run typecheck`
- `npm run build`
- `npm run test`
- `npm run validate`

## Known Limitations

- `workspaceStore.ts` is still a large coordination module even after extraction
- `GitButton.css` remains oversized and concentrated
- Browser navigation state in the renderer is still polled rather than event-driven
- No renderer integration or end-to-end test coverage exists yet for workspace, pane, or git UI flows
- The renderer bundle still carries a large async `xterm` chunk, though the initial bundle is much smaller than before

## Acceptance Criteria For The Current Product

- User can create a workspace from the gate or modal dialog
- User can switch between multiple workspace tabs without losing per-workspace state
- User can launch additional terminal or harness sessions inside the active workspace
- User can resize, dock, swap, and rebalance panes
- User can show and hide the native browser panel
- User can inspect git status and perform branch, merge, stash, and commit actions from the UI
- User can optionally generate commit messages through a supported AI provider
- `npm run validate` passes on the repository
