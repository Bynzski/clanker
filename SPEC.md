# Clanker Grid — Technical Specification

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Electron Main                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────────┐  │
│  │ Window  │  │  PTY    │  │ Browser │  │   GitService    │  │
│  │ Manager │  │ Pool    │  │ View    │  │   (git CLI)     │  │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────────┬────────┘  │
│       │            │            │                 │           │
│       └────────────┴────────────┴─────────────────┘           │
│                           │ IPC (preload bridge)                │
└───────────────────────────┼───────────────────────────────────┘
                            │
┌───────────────────────────┼───────────────────────────────────┐
│                    Renderer Process                            │
│  ┌──────────────┐  ┌─────┴──────┐  ┌────────────────────────┐  │
│  │ React App    │  │ Zustand    │  │ Components (xterm.js)  │  │
│  │ (Vite)       │  │ Store      │  │                        │  │
│  └──────────────┘  └────────────┘  └────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

## Stack

| Layer | Technology |
|-------|------------|
| Shell | Electron 41.x |
| Renderer | React 19, TypeScript 6, Vite |
| State | Zustand 5.x |
| Terminal | node-pty + @xterm/xterm |
| Layout | react-resizable-panels + @dnd-kit |
| Storage | electron-store |
| Browser | WebContentsView (native) |

## Data Models

### Workspace

```typescript
interface Workspace {
  id: string;
  name: string;
  path: string;
  harness: HarnessId;
  harnessModel?: string;
  terminals: Terminal[];
  panes: PaneTree;
  browser: BrowserState;
  activeTerminalId: string | null;
}

interface BrowserState {
  visible: boolean;
  url: string;
  paneLocked: boolean;
}
```

### Pane Tree

```typescript
type PaneTree = 
  | { type: 'leaf'; paneId: string }
  | { type: 'split'; orientation: 'horizontal' | 'vertical'; ratio: number; children: [PaneTree, PaneTree] };
```

### Terminal

```typescript
interface Terminal {
  id: string;
  pid: number;
  cwd: string;
}
```

### Git Types

```typescript
interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: FileChange[];
  unstaged: FileChange[];
  conflicted: string[];
  operation: 'merge' | 'rebase' | null;
}

interface GitStash {
  id: string;
  description: string;
  branch: string;
  date: string;
}
```

## IPC Channels

### Terminal

| Channel | Direction | Payload |
|---------|-----------|---------|
| `terminal:spawn` | renderer → main | `{ cwd, harness, model? }` |
| `terminal:write` | renderer → main | `{ id, data }` |
| `terminal:resize` | renderer → main | `{ id, cols, rows }` |
| `terminal:kill` | renderer → main | `{ id }` |
| `terminal:data` | main → renderer | `{ id, data }` |
| `terminal:exit` | main → renderer | `{ id, code }` |

### Git

| Channel | Direction | Payload |
|---------|-----------|---------|
| `git:status` | renderer → main | `{ workspacePath }` |
| `git:commit` | renderer → main | `{ message }` |
| `git:branch` | renderer → main | `{ action, name? }` |
| `git:stash` | renderer → main | `{ action, name? }` |
| `git:merge` | renderer → main | `{ branch, action }` |

### Browser

| Channel | Direction | Payload |
|---------|-----------|---------|
| `browser:navigate` | renderer → main | `{ url }` |
| `browser:back` | renderer → main | `{}` |
| `browser:forward` | renderer → main | `{}` |

### Session History

| Channel | Direction | Payload |
|---------|-----------|---------|
| `session-discover` | renderer → main | `{ workspacePath? }` → `HarnessSession[]` |
| `session-invoke` | renderer → main | `{ session, fork? }` → `TerminalInfo` |

Session history discovers past AI harness sessions and allows resuming them. Sessions are discovered from harness-specific storage locations and filtered by workspace path.

## Security

- Context isolation enabled
- Renderer sandbox enabled
- URL schemes restricted (http/https for browser)
- External links restricted (http/https/mailto)
- Directory paths validated before use
- Git operations use argument-safe invocation

## Build Output

| Directory | Contents |
|-----------|----------|
| `dist/main/` | Compiled main process |
| `dist/renderer/` | Vite production bundle |
| `release/` | electron-builder output |
| `coverage/` | Test coverage reports |

## CLI Commands

```bash
npm run dev              # Dev mode (renderer + main)
npm run build            # Production build
npm run validate         # lint + typecheck + build + test
npm run build:dist       # Create distributable
```
