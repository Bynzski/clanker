# Remote process persistence and reconnect

Status: **Proposed for architecture review; runtime implementation has not started.**

Tracks [issue #47, item 6](https://github.com/Bynzski/clanker/issues/47). That issue asks for a separate transport evaluation before changing the SSH PTY path. This document defines the proposed contract and the first implementation slices.

Current removal-operation records persist safety reservations across desktop restart and reconcile host completion journals. They track filesystem operations, not surviving remote terminal processes. Native conversation resume also starts a new process; neither mechanism implements this proposal.

## Recommendation

Add an explicit **Keep running on host** option backed by a dedicated tmux server on the SSH host. Main owns its process registry and local attachments through `WorkspaceEnvironment`. Use system OpenSSH for every request. Preserve ordinary terminal launches as the default.

A terminal attachment and a remote process must have separate identities and lifetimes. Closing an attachment, closing a workspace, or quitting the desktop disconnects a persistent process. **Stop remote process** is a separate explicit action. Reconnect attaches to the exact existing process; a failed reconnect never launches another harness or replays a prompt.

Persistence applies to all installed harnesses because tmux supplies the terminal, independently of native conversation formats. The first prototype must exercise Codex, Claude, OpenCode, Pi, OMP, Antigravity, and Hermes. Native history support remains a separate capability.

Host reboot survival, automatic reconnect, and remote Agent Attention are later increments. The prototype must reject persistence combined with attention, with an actionable explanation; it must not silently ignore either requested setting.

## Transport evaluation

| Approach | Fit | Decision |
| --- | --- | --- |
| tmux | Supplies an interactive terminal with detach/attach and a scriptable server/client model. | Preferred prototype. |
| GNU Screen | Also supports detached interactive sessions. | Viable alternative if deployment demand justifies a second adapter. |
| systemd user services | Provides service lifetime management; keeping a user service manager after logout can require lingering. | Reconsider for supervised background commands; interactive terminal reconstruction needs additional work. |
| Clanker-owned PTY helper | Could provide a custom transport and lifecycle channel. | Defer: adds deployment, upgrades, protocol maintenance, and remote process supervision responsibilities. |

The terminal properties above are documented in the [tmux getting-started guide](https://github.com/tmux/tmux/wiki/Getting-Started) and [GNU Screen detach documentation](https://www.gnu.org/software/screen/manual/html_node/Detach.html). User-service lingering is described in [loginctl documentation](https://www.freedesktop.org/software/systemd/man/252/loginctl.html). The preference is a Clanker design judgment, not a guarantee of compatibility with every host configuration.

## Ownership and identity

Introduce a persisted `RemoteProcessRecord`, separate from the desktop `Terminal` and the harness-native conversation history:

- Random process UUID, installation UUID, schema version, and immutable launch generation.
- Saved environment ID and a fingerprint of its target configuration at launch.
- Canonical workspace root and canonical launch cwd.
- Harness ID, tmux session/pane IDs, and launch timestamp.
- Last verified host status and observation time; no persisted attention credentials.

A local attachment gets a new terminal ID on each connection and refers to the remote process UUID. Resolve renderer requests by `workspaceId` plus process UUID; obtain target, cwd, and tmux identifiers from main-owned records and verified host metadata. Never accept an arbitrary remote command, socket path, session name, or PID from the renderer.

The host stores a matching manifest and operation journal in a private directory under the SSH account's home. Validate canonical ancestors, ownership, non-symlink entries, and permissions before access. Directories must be owned by the SSH UID with mode `0700`; manifests/scripts use `0600` or `0700` as appropriate. Refuse unsafe existing directories. Socket names and manifest names derive only from validated UUIDs.

Use a Clanker-specific socket/server for the installation. Never attach to or terminate the account's ordinary tmux server. Disable user tmux configuration for the managed server; explicitly configure the terminal options and test keyboard, resize, Unicode, and color behavior. Select the minimum supported tmux version from prototype results and feature probes, rather than assuming the host runs the current release.

Each managed session has one harness pane. An owned wrapper records harness exit and ends the pane; there is no fallback shell in the first persistent mode. This makes process completion explicit and prevents a completed agent's shell from appearing as a live harness. Ordinary SSH terminals retain their current fallback shell behavior.

A host fingerprint mismatch blocks automatic reuse. It does not prove an old host process stopped. Saved target edits/deletion remain blocked while managed processes are running or their status is unknown, including processes whose workspace has been closed. Any future migration/forget UI must explain that forgetting a record does not stop the host process.

## Launch and reconnect protocol

### Launch

1. Resolve the registered workspace and recheck root confinement, removal reservations, shutdown, and harness availability.
2. Probe the supported tmux interface and private host storage. A failed probe leaves an actionable error and creates no process.
3. Reserve a process UUID and launch operation UUID locally, then write a host manifest atomically under an exclusive host lock.
4. Create a detached tmux session using a safely constructed main-owned wrapper command. Persist its exact identifiers and start/exit evidence before acknowledging launch.
5. Recheck the workspace and reservations, then attach an SSH client. If the workspace closed during creation, retain the verified detached process record and surface it in the environment's saved-process list.

Creation is idempotent by process/operation UUID and manifest contents. If SSH fails after creation may have started, retain an **unknown** outcome and query the journal on retry. Never retry by launching a second session. Never use create-or-attach behavior to replace a process missing during reconnect.

### Reconnect

1. Resolve the same environment and registered workspace. Validate the manifest, installation/generation, canonical cwd, target fingerprint, and process status on the host.
2. If it exited, report its real exit evidence and offer native conversation Resume from Chat History separately.
3. If running, acquire an exclusive writer attachment lease under the host lock. Refuse another writer instead of detaching somebody else's client. A failed/expired claim must be reconciled against actual tmux client presence before reuse.
4. Attach to the exact session/pane and bind the new local terminal to the owning workspace. Late attachment results use the same close/switch ownership checks as native resume.
5. Release the attachment lease when its client ends. An SSH error changes connectivity to **unknown/disconnected** until host status is verified; it does not mark the harness exited.

Discovery only reads Clanker-owned manifests and validates live state; it never adopts arbitrary user tmux sessions. Bound each request to 128 managed records, 1 MiB of metadata, and a finite timeout. Report overflow as an error. Batch active-environment status checks without overlap or per-process SSH polling; use backoff on transport failures.

## State and controls

Track connectivity independently of host execution:

| Host execution | Attachment | UI/action |
| --- | --- | --- |
| Verified running | Connected | Terminal input and resize; Disconnect; Stop remote process |
| Verified running | Disconnected | Running on host; Reconnect; Stop remote process |
| Unknown | Disconnected | Status unknown; Verify/retry; no inferred completion or replacement launch |
| Verified exited | Disconnected | Exit status/time; native Resume from Chat History |

This record is the only persisted launch state for persistent processes; the removed Workspace Tasks subsystem must not be reintroduced to describe them. Model connectivity independently of host execution and never reinterpret a detached process as stopped solely because its local attachment exited. Do not overwrite its original launch time or evidence when reconnecting.

- Workspace tab switch keeps an attachment connected.
- Disconnect and persistent terminal/workspace close terminate only the local SSH client.
- App shutdown terminates all local PTYs and records attachment disconnection; it sends no host stop request for persistent records.
- Stop targets the verified owned tmux session under the host lock. Record acknowledged exit; preserve an unknown outcome on transport failure. Do not claim stop succeeded solely because the local client exited.
- Host restart, missing session, or a missing socket requires verification and an explicit unavailable/exited explanation. Reconnect must not create a new process.

Worktree inspection/removal must include managed running **and unknown** processes, even when no workspace or local PTY remains. Reuse the registry's shared SSH-target resource identity for duplicate saved aliases. Reserve cwd/root while launch or stop is uncertain, and consult host manifests under the same lock immediately before removal. Desktop memory alone cannot protect a detached process from another desktop instance.

## Agent Attention and annotations

The current remote attention protocol sends per-terminal credentials through OSC frames on the SSH PTY. A detached process outlives that terminal and its broker registration. Reusing its original token, enabling arbitrary tmux escape passthrough, or treating replayed scrollback as current events is insufficient.

The initial prototype therefore requires attention off for persistent launches. A subsequent design must establish a host-owned, bounded lifecycle channel keyed by process/generation, authenticate a new attachment, and prevent stale events or retired credentials from changing current state. It must cover every existing harness adapter and cleanup on confirmed host exit. Host-side launch resources belong to the persistent process and cannot be deleted by an attachment's `onExit` callback.

Annotation handoff remains disabled for persistent processes until a live harness target can be verified independently of tmux pane existence. A pane's shell or terminal title is not proof of an agent target.

## Integration boundaries

- `WorkspaceEnvironment`: add explicit optional persistence operations/capability after architecture review. Keep native session discovery and ordinary `resolveTerminalSpawn` separate.
- `src/main/remote/`: implement focused persistence/manifest/tmux collaborators; leave `SshEnvironment` as their facade.
- Main coordinator: own creation journals, leases, records, attachment mappings, and uncertain outcomes.
- IPC: structured requests using channel constants; registered workspace identity and process UUID only.
- Persistence: schema migration for process records and environment-edit locks; no remote secrets in electron-store.
- Renderer: explicit opt-in, remote-running status, reconnect/disconnect/stop actions, and ownership-safe asynchronous updates.

## Implementation slices and release gates

1. **Read-only capability and status prototype:** probe tmux/features, validate private manifests, and inspect a unique fixture session. No product launch toggle yet.
2. **Host lifecycle collaborator:** exclusive/idempotent create, inspect, and stop with journals. Test unknown outcomes and security checks using a temporary fixture.
3. **Opt-in launch and manual reconnect:** attachment ownership, process status, environment/worktree protections, renderer controls, and shutdown behavior. Reject attention-enabled persistence until its transport is implemented.
4. **Persistent attention:** implement and review credential/event handling across all harness adapters before enabling the combination.
5. **Connection UX:** consider automatic retries only after manual reconnect is reliable. Host reboot restart remains a separate proposal.

Required acceptance checks:

- Complete one run of every installed harness in a unique VPS fixture; verify the same remote process survives desktop disconnect, workspace close, and app restart, without prompt replay.
- Reconnect from the same environment only; same-path local and other-host workspaces remain independent. A target fingerprint change blocks reuse.
- Kill SSH during each creation/attach/stop step; verify one host process, journal reconciliation, and honest unknown status.
- Concurrent creation with the same UUID is idempotent. Two writers, overlapping reconnects, and a workspace close during attachment cannot leak local clients or hijack another workspace.
- Reject foreign/symlinked/writable directories, modified manifests, malformed UUIDs, out-of-root cwd, and unowned tmux sessions.
- Refuse worktree removal for detached/unknown processes, including duplicate target aliases and a second desktop instance.
- Confirm an exited harness does not become a writable fallback shell; native conversation resume remains distinct from process reconnect.
- Verify terminal redraw, scrollback bounds, keyboard shortcuts, bracketed paste, resize, and Unicode across supported desktop platforms and the selected tmux versions.
- Reject the attention/persistence combination explicitly until tested; preserve normal attention-enabled ordinary launches.
- Run targeted tests and `npm run validate` for every implementation slice. Follow the existing VPS smoke protocol and preserve `clanker-test`.

## Review decisions

This proposal recommends tmux, explicit opt-in, disconnect-on-close/quit semantics, one writer, and no fallback shell for persistent harnesses. Review these choices before exposing the runtime feature. The capability prototype is the next implementation slice once this architecture is accepted.
