# Browser Tabs & History

Each workspace has its own browser tabs. Each tab has a native Electron `WebContentsView`; the URL bar and toolbar controls operate on the active tab.

## Tabs

The tab strip sits above the browser toolbar. Click **+** to open a tab at `https://github.com`, click a tab to switch, or click its **×** to close it. The last tab cannot be closed. Drag a tab to reorder it, or focus its button and press `Alt+Shift+Left/Right`.

Switching tabs keeps the other tabs' pages alive. Closing an active tab selects an adjacent tab. Browser tabs belong to their workspace and are disposed when that workspace closes.

## Navigation and history

The toolbar provides Back, Forward, Refresh, Stop, a URL field, an external-browser button, and annotation mode. The address bar can open HTTP(S) URLs and local `file:` URLs or absolute paths. Pages cannot navigate themselves to local files; web-initiated navigation is limited to HTTP(S). Page URLs and titles from HTTP(S) navigation are stored in a global history across workspaces and app restarts. History keeps the most recent 100 distinct URLs and returns up to 8 suggestions; local files are not stored.

Type at least two characters in the URL field to see matching history entries. Suggestions appear after a 300 ms debounce. Use the arrow keys and Enter, click a suggestion, or press Escape to dismiss them. History matches URL and hostname prefixes, including hostnames without `www.`.

## DevTools and shortcuts

Right-click browser content to open DevTools or inspect an element. `Ctrl/Cmd+Shift+I` and `F12` toggle detached DevTools for the focused tab. Zoom shortcuts apply to the browser tab when browser content has focus; otherwise they apply to the app UI. See [Keyboard Shortcuts](keyboard-shortcuts.md).

## Annotation

Switching tabs or closing the active tab disables annotation mode. Enable it again on the new tab. See [Browser Annotation](browser-annotation.md).

## Implementation

Main-process tab views, navigation, and bounds live in `src/main/ipc/browserIpc.ts`; history lives in `src/main/browserHistory.ts`. Renderer tab state is in `src/renderer/store/workspaceStore.ts`, and the tab strip is `src/renderer/components/BrowserTabStrip.tsx`. IPC channel constants live in `src/shared/ipcChannels.ts`. The tab state contracts are in [Workspace State Invariants](../src/renderer/store/INVARIANTS.md).
