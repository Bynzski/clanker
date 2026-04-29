# Browser Tabs & History

The embedded browser supports multiple tabs and preserves your navigation history for quick access.

## Overview

Each workspace has its own browser with:
- **Multiple tabs** — Switch between sites without leaving the workspace
- **Navigation history** — Autocomplete suggestions based on your browsing history
- **URL bar** — Direct navigation to any HTTP(S) URL

## Browser Tabs

### Tab Concepts

- Each workspace browser has its own set of tabs
- Tabs are backed by native browser views — one view per tab
- The URL bar always reflects the active tab's current URL
- Closing the last tab is not allowed; at least one tab always exists

### Tab Structure

| Element | Description |
|---------|-------------|
| Tab count button | Shows number of open tabs and active tab title |
| Tab list | Dropdown showing all tabs with titles and URLs |
| New tab (+) | Creates a new tab, defaults to GitHub |
| Close tab (×) | Closes the tab (disabled for last tab) |

### Using Tabs

#### Creating a New Tab

1. Click the **tab count button** in the browser toolbar
2. Click the **+** button in the dropdown
3. A new tab opens to `https://github.com`
4. The new tab becomes active

#### Switching Tabs

1. Click the **tab count button** in the browser toolbar
2. Click any tab in the dropdown
3. The browser navigates to that tab and the URL bar updates

#### Closing a Tab

1. Open the **tab dropdown**
2. Click the **×** button on any tab (except the last one)
3. If you close the active tab, the next adjacent tab becomes active

### Tab Behavior

| Action | Behavior |
|--------|----------|
| Last tab close | Prevented — always keep at least one tab |
| Active tab close | Selects the adjacent tab (next, then previous) |
| Inactive tab update | Does not change the URL bar or active tab state |
| Tab bounds | Pane geometry is preserved across tab operations |

## Navigation History

### How History Works

Your navigation history is stored globally and persists across:
- Tab switches
- Workspace switches
- App restarts

History entries include:
- **URL** — The full HTTP(S) URL
- **Title** — Page title (when available)
- **Last visited** — Timestamp of most recent navigation

### History Storage

| Property | Value |
|----------|-------|
| Maximum entries | 100 |
| Query results | Up to 8 matches |
| Storage location | `electron-store` (`browser-navigation-history`) |

### Security

- Only `http://` and `https://` URLs are stored
- `about:blank`, `file://`, `javascript:`, and other schemes are never stored
- New tabs open to `https://github.com` (not `about:blank`)

## URL Autocomplete

### Triggering Suggestions

1. Focus the URL input
2. Type at least 2 characters
3. History suggestions appear below the input (debounced by 300ms)

### Suggestion Features

- Shows URL and title for each match
- Keyboard navigation: Arrow Up/Down to highlight, Enter to select
- Escape closes the suggestion dropdown
- Click a suggestion to navigate

### Example Flow

1. You navigate to `https://github.com/user/repo` several times
2. Later, type `github.com/user` in the URL bar
3. `https://github.com/user/repo` appears as a suggestion
4. Press Enter or click to navigate

### Prefix Matching

Suggestions match against:
- Full URL (lowercase)
- Hostname (lowercase)
- Hostname + pathname (lowercase)
- Stripped `www.` variants

For example, typing `local` matches `localhost:3000`, `http://localhost:8080/api`, etc.

## Tab + History Workflow

```
┌──────────────────────────────────────────────────────────────┐
│ Open workspace → Browser has 1 tab (github.com)              │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ Navigate to localhost:3000 → Tab URL updates                  │
│ History records: https://localhost:3000                       │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ Create new tab → New tab opens to github.com                  │
│ History not recorded for default pages                         │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ Type "local" in URL bar → "localhost:3000" appears            │
│ Select it → Active tab navigates to localhost:3000            │
└──────────────────────────────────────────────────────────────┘
```

## Browser Toolbar Controls

| Control | Icon | Description |
|---------|------|-------------|
| Back | ← | Navigate back in active tab history |
| Forward | → | Navigate forward in active tab history |
| Refresh | ↻ | Reload current page |
| Stop | × | Stop loading current page |
| Tabs | Number + title | Open tab dropdown |
| URL input | Text field | Enter or edit URL |
| Go | Go button | Navigate to URL |
| External | ↗ | Open URL in system browser |
| Annotate | ⊕ | Toggle annotation mode |

## Browser DevTools

Each browser tab has an integrated DevTools panel for debugging and inspecting web content. DevTools opens in a detached window that can be moved to a separate monitor.

### Opening DevTools

There are three ways to open DevTools:

| Method | Shortcut | Description |
|--------|----------|-------------|
| Keyboard | `Ctrl+Shift+I` (or `Cmd+Shift+I` on macOS) | Toggle DevTools for the active tab |
| Context menu | Right-click in browser content | Select "Open DevTools" |
| Inspect element | Right-click in browser content | Select "Inspect Element" — opens DevTools with the element selected |

### DevTools Features

- **Elements panel** — Inspect and modify HTML/CSS
- **Console** — Execute JavaScript and view logs
- **Network tab** — Monitor network requests
- **Sources** — Debug JavaScript with breakpoints
- **Application** — Inspect cookies, storage, and service workers
- **Full debugging** — All standard Chrome DevTools features

### DevTools with Multiple Tabs

DevTools is scoped to each `WebContentsView` (browser tab):

| Action | Behavior |
|--------|----------|
| Open DevTools | Opens DevTools for the active tab's view |
| Switch tabs | Each tab has its own DevTools state; switching tabs does not switch DevTools windows |
| Close DevTools | Closes only for the current tab; other tabs' DevTools remain open |
| Inspect Element | Opens DevTools with that element selected |

### Keyboard Shortcuts

When the browser has focus, these shortcuts apply to the active browser tab:

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+I` / `Cmd+Shift+I` | Toggle DevTools |
| `F12` | Toggle DevTools (alternative) |
| `Ctrl+Shift+F` / `Cmd+Shift+F` | Fit all panes |
| `Ctrl+0` / `Cmd+0` | Reset browser zoom to default |
| `Ctrl+=` / `Cmd+=` | Zoom browser in |
| `Ctrl+-` / `Cmd+-` | Zoom browser out |

Browser zoom is separate from application zoom. The same zoom shortcuts control the app UI only when focus is outside the embedded browser.

### Technical Details

DevTools uses Electron's `webContents.openDevTools({ mode: 'detach' })` to open in a detached window. The detached mode allows:
- Moving DevTools to a separate monitor
- Resizing independently of the main window
- Multiple DevTools windows open simultaneously (one per tab)

The DevTools window is associated with the specific `WebContentsView` that was active when opened. If you switch to a different tab while DevTools is open, the DevTools window continues to inspect the original tab's content.

### Context Menu

Right-click in the browser content to access:
- **Open DevTools** — Opens DevTools for the current tab
- **Inspect Element** — Opens DevTools with the clicked element selected

## Annotation Mode

When annotation mode is active:
- Tabs can still be switched
- URL bar and history suggestions remain functional
- Exiting annotation via Escape keeps current tab

### Annotation + Tab Behavior

| Scenario | Behavior |
|----------|----------|
| Switch tab while annotating | Annotation disables, re-enable manually |
| Close active tab while annotating | Annotation disables |
| Switch away from workspace | All tab views hide, annotation state preserved |

## IPC Channels

The browser tab and history features use these IPC channels:

### Tab Operations

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `BROWSER_CREATE_TAB` | renderer → main | Create new tab view |
| `BROWSER_CLOSE_TAB` | renderer → main | Close tab view |
| `BROWSER_SWITCH_TAB` | renderer → main | Switch active tab |
| `BROWSER_GET_TABS` | renderer → main | Get tab list |
| `BROWSER_TAB_NAVIGATE` | renderer → main | Navigate specific tab |
| `BROWSER_URL_UPDATED` | main → renderer | Tab URL changed |

### History Operations

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `BROWSER_HISTORY_ADD` | renderer → main | Add entry to history |
| `BROWSER_HISTORY_GET` | renderer → main | Query history |
| `BROWSER_HISTORY_CLEAR` | renderer → main | Clear all history |

### Legacy Support

| Channel | Behavior |
|---------|----------|
| `BROWSER_NAVIGATE` | Falls back to active tab |
| `BROWSER_SET_BOUNDS` | Supports optional tab ID |

For backward compatibility, workspace-scoped browser APIs continue to work but are routed to the active tab when tab ID is not specified.

## Technical Architecture

### Main Process

```
Map<workspaceId, Map<tabId, BrowserViewEntry>>
Map<workspaceId, activeTabId>
Map<workspaceId, lastBrowserBounds>
```

- One `WebContentsView` per tab per workspace
- Active tab tracked per workspace
- Bounds stored per workspace (applied to active tab on visibility)

### Renderer Store

```ts
BrowserPaneState {
  id: string;
  position: PanePosition;
  tabs: BrowserTab[];
  activeTabId: string | null;
}

BrowserTab {
  id: string;
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
}
```

### URL Synchronization

- `browserUrl` field mirrors active tab URL (compatibility)
- Updating inactive tabs does not change `browserUrl`
- Tab switching updates URL bar immediately

## Invariants

| Invariant | Description |
|-----------|-------------|
| `tabs.length >= 1` | Browser pane always has at least one tab |
| Unique tab IDs | Tab IDs are renderer-generated, unique per workspace |
| `activeTabId` references existing tab | When pane exists, active tab ID is valid |
| `browserUrl` = active tab URL | Compatibility mirror follows active tab |
| Pane position unchanged | Tab operations never modify pane geometry |

See [INVARIANTS.md](../renderer/store/INVARIANTS.md) for full invariant documentation.

## Future Enhancements

Potential additions:
- **Drag-to-reorder tabs** — Reorder tabs in the dropdown
- **Middle-click close** — Quick tab close with mouse
- **Per-tab persistent sessions** — Separate cookies/history per tab
- **History deletion** — Remove individual history entries
- **Configurable history size** — User-defined max entries
- **Browser bookmarks** — Save and organize URLs