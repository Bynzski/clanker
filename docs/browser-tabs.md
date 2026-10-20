# Browser Tabs & History

Each workspace has its own browser tabs. Each tab has a native Electron `WebContentsView`; the URL bar and toolbar controls operate on the active tab.

## Tabs

The tab strip sits above the browser toolbar. Click **+** to open a tab at `https://github.com`, click a tab to switch, or click its **×** to close it. The last tab cannot be closed. Drag a tab to reorder it, or focus its button and press `Alt+Shift+Left/Right`.

Switching tabs keeps the other tabs' pages alive. Closing an active tab selects an adjacent tab. Browser tabs belong to their workspace and are disposed when that workspace closes.

## Navigation and history

The toolbar provides Back, Forward, Refresh, Stop, a URL field, an external-browser button, and annotation mode. The address bar can open HTTP(S) URLs and local `file:` URLs or absolute paths. A local document inside a registered local workspace can follow links to existing files within that same workspace root; symlink escapes are rejected. Local links requesting a new window open in the same browser tab, provided every embedded frame is also a local document within the root. Remote pages, remote frames, and server redirects cannot navigate to local files. SSH workspaces and Assistants do not grant file-link navigation within desktop directories. Page URLs and titles from HTTP(S) navigation are stored in a global history across workspaces and app restarts. History keeps the most recent 100 distinct URLs and returns up to 8 suggestions; local files are not stored.

The browser runs in the desktop app even when the workspace is on SSH. A `file:` URL refers to a local desktop file. Workspace-owned remote HTTP(S) services can be discovered and forwarded automatically while Browser is active; ambiguous listeners require selection. See [SSH browser previews](workspaces.md#ssh-browser-previews). Local checkout servers use the explicit [dev-server Browser action](dev-services.md).

The address bar accepts Google searches as well as addresses, in new tabs and on existing pages. Domains open with HTTPS; localhost and loopback addresses default to HTTP. Ordinary words, phrases, and bare numbers search Google. Explicit malformed addresses and unsupported schemes show an error. Absolute local paths preserve spaces and URL-special characters. Search text is sent to Google only on submission; there is no network autocomplete.

The dropdown starts with the explicit Search/Open action. Enter and Go execute that action unless a history suggestion was selected with the arrow keys or pointer. Escape dismisses the dropdown and cancels pending suggestions. Focusing an empty field shows recent history; typing at least two characters queries history after a 150 ms debounce. Changes discard old results immediately, and replies from dismissed or replaced queries cannot reopen the dropdown.

Document title updates refresh searchable metadata without changing visit order. History ranks URL/hostname intent ahead of title/path words, substring matches and conservative one-edit fuzzy matches, using recency within each tier. `localhost` finds recent IPv4/IPv6 loopback endpoints too; a bare port such as `8000` prioritizes exact local port matches over numbers in page paths or titles. Broad hostname searches such as `chat` put site homepages ahead of deep conversation URLs. If only a deep URL was visited, a website suggestion can be derived from its origin without recording a visit; local endpoints and credential-bearing URLs do not generate these site suggestions. Path-specific queries keep their path intent. Titles and URLs display matching text, and the combobox supports keyboard navigation and independent accessible IDs across panes.

## Notifications

When Browser is visible, pending app notifications appear as a compact chip in its
header above the native page. Expand it for the recent stack and actions; the
app's notification-history control retains other recent messages. Browser
notification chrome does not redirect the active page or change workspace ownership.

## DevTools and shortcuts

Right-click browser content to open DevTools or inspect an element. `Ctrl/Cmd+Shift+I` and `F12` toggle detached DevTools for the focused tab. Zoom shortcuts apply to the browser tab when browser content has focus; otherwise they apply to the app UI. While the browser has focus, `Cmd/Ctrl+L` focuses the address field, `Cmd/Ctrl+T` / `Cmd/Ctrl+W` open and close tabs, `Cmd/Ctrl+R` refreshes, and `Ctrl+Tab` / `Ctrl+Shift+Tab` cycle tabs. These are configurable; see [Keyboard Shortcuts](keyboard-shortcuts.md).

## Annotation

Switching tabs or closing the active tab disables annotation mode. Enable it again on the new tab. See [Browser Annotation](browser-annotation.md).

## Implementation

Main-process tab views, navigation, and bounds live in `src/main/ipc/browserIpc.ts`; history lives in `src/main/browserHistory.ts`. Renderer tab state is in `src/renderer/store/workspaceStore.ts`, and the tab strip is `src/renderer/components/BrowserTabStrip.tsx`. IPC channel constants live in `src/shared/ipcChannels.ts`. The tab state contracts are in [Workspace State Invariants](../src/renderer/store/INVARIANTS.md).

After building, `npm run smoke:browser-file-links` exercises real local-document links, popup routing, URL reporting, workspace confinement and remote/iframe/redirect pivot protection using a temporary profile and fixture. A working desktop display is required; on Linux an explicit `--ozone-platform=x11 --disable-gpu` can be used when needed.
