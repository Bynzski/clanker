# Corrective-pass live Electron acceptance

Captured from the actual app running with a disposable profile and an owned SSH Node HTTP fixture:

- `remote-browser-compact.png`: existing Browser chrome with only the small server icon/status dot; no permanent preview row.
- `remote-preview-menu.png`: compact advanced popover using the existing shared native-overlay lease.
- `remote-preview-page.png`: rendered content from the native Browser WebContentsView.

Electron's BrowserWindow capture excludes child WebContentsViews. The page is therefore a separate native capture; the blank rectangle in the window captures is not a failed page load. Live acceptance confirmed automatic opening and same-URL/same-SSH-child recovery after stopping and restarting the fixture. Screenshots contain disposable fixture metadata, not real workspace content or credentials.
