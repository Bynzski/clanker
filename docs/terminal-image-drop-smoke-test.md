# Terminal image drops

Clanker hands off one saved local image's quoted path through xterm paste, without submitting Enter. The receiving harness/TUI owns attachment interpretation; Clanker does not upload image bytes or create an attachment itself. This applies to local workspace terminals and connected, active Hermes Assistant/Bot Chat surfaces, including a Hermes-owned input dialog rendered inside that terminal.

## Manual checks

1. Open an active, connected Assistant and drop a saved PNG from the desktop file manager into Bot Chat. Verify Hermes receives the path once, does not submit the prompt automatically, and recognizes the attachment according to its native input behavior.
2. Repeat with Hermes' paste/input dialog open, then with a regular local workspace harness terminal. Test paths containing spaces and apostrophes. At a shell prompt, the path must remain quoted and must not execute a command.
3. Drop a browser image without a local file, a non-image file, or several files. Verify a visible explanation and no fabricated filename, automatic download, navigation, or terminal input. Save the browser image to disk and drop that file to proceed.
4. Disconnect the Assistant or park its surface. Verify no drop input is forwarded. Reconnect and repeat the valid drop.
5. Drop a desktop image into an SSH workspace terminal. Verify the remote-host guidance appears and no desktop path is forwarded.

Clipboard image bytes (Ctrl+V of a screenshot) are not imported by this change. Normal text paste remains xterm-owned. Remote image upload, browser-image downloads and multi-image import are out of scope.

Automated tests cover path resolution/quoting, control-character rejection, unsupported drops, readiness/activity guards, SSH rejection, and Assistant/workspace PTY routing. Hermes attachment recognition itself requires the manual checks above.
