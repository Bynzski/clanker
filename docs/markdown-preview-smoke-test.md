# Markdown preview smoke test

In a local workspace, open a `.md` or `.markdown` file from Explorer.

- It starts in **Edit**. Switch to **Preview** for headings, lists, tables, task lists and code blocks.
- Make an unsaved edit, preview it, then return to Edit. Text, selection and undo/redo should remain intact. Switching views must not save or reload the file.
- Save using the normal editor shortcut. Edit a clean file externally and verify preview reloads; change a dirty file externally and verify Reload/Keep Mine still appears. Close a dirty preview and verify the unsaved-changes confirmation.
- Switch tabs, workspaces and themes. A tab remembers its mode while its editor pane remains mounted. Ordinary files have no preview controls. Parked workspaces must not accept preview interactions.
- Repeat with a file in a registered worktree and in an SSH workspace. No separate file read is needed to render preview.

## Untrusted content and links

- Raw HTML (including scripts, event handlers, iframes and embeds) is disabled.
- HTTP(S) links use the existing safe external-open bridge.
- Relative file links resolve from the Markdown file's directory, stay inside its pinned checkout, and open through the normal editor read. Main still validates symlink containment, file size and text eligibility. SSH links stay on the owning SSH workspace.
- Links outside that root, links into released/missing checkouts, unsafe schemes, and fragment-only links are unavailable in this first version.
- Images show alt-text placeholders. Preview grants neither `file://` access nor automatic remote image requests. Local image loading needs a validated resource bridge before it can be enabled.

Check these behaviors with `../outside.md`, an outside-root symlink, `[unsafe](javascript:alert%281%29)`, raw `<script>`/`<iframe>` markup, and relative/remote images. No renderer navigation or automatic image request should occur.
