# Clanker Grid - Workspace Launcher

## Project Overview
- **Project Name**: Clanker Grid
- **Type**: Desktop Application (Electron + React)
- **Core Feature**: A developer workspace tool that displays multiple terminal instances in a configurable grid layout with an embedded native web browser using Electron's BrowserView API
- **Target Users**: Developers who need to quickly open workspace environments with multiple CLI sessions

## Technical Stack
- **Framework**: Electron 31.x (Chromium backend + Node.js)
- **Frontend**: React + TypeScript + Vite
- **Terminal**: xterm.js with node-pty for PTY support
- **Web Browser**: Electron BrowserView (native embedded browser)
- **Grid Layout**: CSS Grid with resizable panes
- **State Management**: Zustand
- **Settings Storage**: electron-store for localStorage persistence

## UI/UX Specification

### Layout Structure

#### Workspace Gate (First Launch)
```
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│                        ┌──────┐                              │
│                        │ 📁   │                              │
│                        └──────┘                              │
│                     Clanker Grid                             │
│               Developer Workspace Launcher                   │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ /home/user/projects/                         ⚙ [Browse] │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│                   [ ▶ Launch Workspace ]                      │
│                                                              │
│           ⌨ Multiple    🌐 Browser    📐 Grid               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### Main Application
```
┌─────────────────────────────────────────────────────────────┐
│  Header: App Title + Workspace Controls                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│    Grid Area                                                │
│    (Terminals)                                              │
│                                                             │
│    [Term 1] [Term 2]                                        │
│                                                             │
│    [Term 3] [Term 4]                                        │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  Status Bar: Active terminals count | Working directory      │
└─────────────────────────────────────────────────────────────┘

Note: Browser is embedded as a native BrowserView panel, positioned
in the right portion of the window when toggled on.
```

### Window Configuration
- **Main Window**: Single window application
- **Minimum Size**: 800x600
- **Default Size**: 1200x800
- **Resizable**: Yes

### Visual Design

#### Color Palette
- **Background Primary**: #0d1117 (deep space black)
- **Background Secondary**: #161b22 (panel background)
- **Background Tertiary**: #21262d (hover states)
- **Border Color**: #30363d (subtle borders)
- **Text Primary**: #e6edf3 (main text)
- **Text Secondary**: #8b949e (muted text)
- **Accent Primary**: #58a6ff (links, active states)
- **Accent Success**: #3fb950 (success indicators)
- **Accent Warning**: #d29922 (warning indicators)
- **Accent Error**: #f85149 (error states)

#### Typography
- **Font Family**: "JetBrains Mono", "Fira Code", monospace (terminals)
- **UI Font**: "Inter", -apple-system, BlinkMacSystemFont, sans-serif
- **Header Size**: 16px
- **Body Size**: 14px
- **Terminal Size**: 13px
- **Status Bar**: 12px

#### Spacing System
- **Base Unit**: 4px
- **Small**: 8px
- **Medium**: 16px
- **Large**: 24px
- **XL**: 32px

## Functional Specification

### Core Features

1. **Workspace Gate**
   - Input field for workspace path with autocomplete
   - Cog button opens native directory picker
   - Last used path saved via electron-store
   - Tab/Arrow key navigation for suggestions

2. **Terminal Grid Management**
   - Default: 2x2 grid (4 terminals)
   - Available layouts: 1x1, 1x2, 1x3, 2x1, 2x2, 2x3, 3x1, 3x2, 3x3
   - Each cell contains one terminal
   - Click on terminal to focus

3. **Terminal Emulation**
   - Full PTY support via node-pty
   - Supports ANSI colors
   - Copy/paste support
   - Scrollback buffer (10000 lines)
   - Click to focus, auto-focus on creation

4. **Embedded Browser (BrowserView)**
   - Native Chromium browser embedded via Electron BrowserView API
   - Toggle on/off via header button
   - Full JavaScript and cookie support
   - Back/Forward/Refresh navigation
   - Open in external browser option
   - URL bar with Go button

5. **Workspace Opening**
   - User clicks "Open Workspace" or enters path
   - Native directory picker dialog opens
   - User selects root directory
   - All terminals open to that directory
   - Path displayed in status bar

### User Interactions and Flows

1. **First Launch Flow (Workspace Gate)**
   - App opens with workspace gate screen
   - Input field pre-filled with last used path (from electron-store)
   - Defaults to home directory if no previous path saved
   - User can type path directly or use autocomplete suggestions
   - Cog button opens native directory picker
   - Tab key autocompletes from suggestions
   - Arrow keys navigate suggestions
   - Enter launches workspace with selected path
   - Path is persisted to electron-store

2. **Open Workspace Flow**
   - Click "Open Workspace"
   - Native dialog → Select folder
   - All terminals cd to that directory
   - Status bar updates with path

3. **Browser Toggle Flow**
   - Click "Show Browser" to enable
   - BrowserView created and positioned
   - Click "Hide Browser" to disable
   - BrowserView removed from window

### Data Flow & Key Modules

```
┌─────────────────────────────────────────────────────────────┐
│                     Main Process (Electron)                  │
├─────────────────────────────────────────────────────────────┤
│  main.ts                                                    │
│    ├── Window management                                    │
│    ├── BrowserView management                               │
│    ├── PTY spawn/resize/kill via node-pty                   │
│    ├── IPC handlers for renderer communication               │
│    └── electron-store for persistence                       │
├─────────────────────────────────────────────────────────────┤
│  preload.ts                                                 │
│    └── Exposes safe IPC bridge to renderer                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ IPC
┌─────────────────────────────────────────────────────────────┐
│                     Renderer Process                         │
├─────────────────────────────────────────────────────────────┤
│  App.tsx                                                    │
│    ├── WorkspaceGate.tsx (initial path selection)           │
│    ├── Header.tsx (workspace controls)                      │
│    ├── TerminalGrid.tsx (grid container)                    │
│    │     └── TerminalPane.tsx (xterm.js terminal)           │
│    └── StatusBar.tsx                                        │
├─────────────────────────────────────────────────────────────┤
│  State Store (Zustand)                                      │
│    ├── workspacePath: string                                │
│    ├── gridLayout: { rows: number, cols: number }           │
│    ├── terminals: Terminal[]                               │
│    └── browserVisible: boolean                              │
└─────────────────────────────────────────────────────────────┘
```

### Edge Cases

1. **No workspace selected**: Terminals spawn to home directory
2. **Invalid directory**: Show error toast, terminals use home
3. **Terminal crash**: Show exit code in terminal pane
4. **Browser navigation error**: BrowserView handles natively
5. **All terminals closed**: Show empty state with "No terminal"
6. **Very long paths**: Truncate with ellipsis in status bar

## Acceptance Criteria

### Visual Checkpoints
- [ ] App window opens at correct default size
- [ ] Dark theme applied consistently across all components
- [ ] Grid displays with 4 terminal panes (2x2 default)
- [ ] Terminal panes have visible borders and gaps
- [ ] Header buttons are clearly labeled and distinguishable
- [ ] Status bar shows workspace path after selection
- [ ] Browser panel appears/hides smoothly when toggled

### Functional Checkpoints
- [ ] Workspace gate requires directory selection before proceeding
- [ ] "Open Workspace" opens native directory picker
- [ ] Selected directory path appears in status bar
- [ ] Terminals spawn and are interactive (accept input)
- [ ] Terminals cd to selected workspace directory
- [ ] "New Terminal" adds terminal to grid
- [ ] Layout selector changes grid configuration
- [ ] Browser panel shows native Chromium content
- [ ] URL bar navigates to entered URLs
- [ ] Terminal close button terminates that terminal

### Performance Criteria
- [ ] App launches in under 3 seconds
- [ ] Terminal input latency under 50ms
- [ ] Memory usage under 500MB with 4 terminals
- [ ] BrowserView loads pages smoothly
