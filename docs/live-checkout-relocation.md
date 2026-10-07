# Checkout relocation: review checkpoint

Tracking: #131, superseding #118 (live relocation), #114 (resume redraw) and
#116 (history reliability). Those originals were closed as superseded, not completed.
This review checkpoint remains **partial implementation**; #131 stays open.

## Implemented

- Explicit `live-relocate` provider strategy with a required runtime native-mover check. Resume/MCP
  support never implies same-turn support. **No shipped provider advertises live relocation yet.**
- Main-owned pending proof gate, installed before native movement. It correlates terminal, root session,
  current foreground turn, snapshot revision and the exact registered target context. API success alone,
  old evidence, another session/terminal, turn settlement and unsolicited location reports cannot commit.
- Bounded native operation/proof wait, cancellation/shutdown, registry/context/terminal revalidation and
  synchronous compare-and-rebind of bridge grant + terminal checkout/cwd. The token stays launch-scoped;
  capabilities do not expand. Captured old grants cannot revive, even after a move back (ABA).
- Distinct `terminal-checkout-changed` notification preserving terminal ID, pane and cached xterm.
  Successful live calls can return normally in the same turn; replacement providers retain boundary
  guidance. Completion still moves first and uses existing release/inspect/remove protections second.
- OpenCode's verified-root `session.updated` directory change now publishes immediate `location_changed`
  evidence, without manufacturing a turn boundary. Child updates and duplicates do not move the root.
- Lifecycle rediscovery rejects a different native ID/harness and rechecks session/caller authority after
  awaiting discovery. After-turn moves recheck the root, settled turn, terminal and contexts after
  inspection/history awaits, so a newly started turn is never killed for an old scheduled move.
  Recovery accepts Git reconciliation's value-identical context objects. A newly created target remains
  recoverable on failed movement.
- Replacement PTYs inherit the source pane's latest known columns/rows, before source retirement.
- Startup buffering no longer forwards the suffix ahead of the held prefix. At the bound it pauses
  node-pty's **Node socket reads**, not XON/XOFF (`handleFlowControl: false` remains). Memory holds at most
  the configured bound plus one native chunk. READY drains once before resuming; initial resize cannot
  accidentally lift this startup backpressure. This applies to local and SSH PTYs. A real POSIX PTY
  regression emits 100 KB, proves reads stop before READY, and verifies exact ordered delivery after it.
- Partial history scans remain visible with warnings, but cannot overwrite a complete last-good renderer
  cache. Partial idle warm-ups retry when returning to their workspace.

### Follow-up: ordinary local history handoffs

Default-account resume/fork now rediscover the native harness/ID with forced freshness,
across the bounded checkout scopes, before routing or checkout side effects. Renderer
launch hints are ignored; missing/conflicting/malformed native evidence and selected-provider
or scope failures block invocation, while unrelated provider failures do not. Canonical native
cwd prevents symlink escapes. Workspace and provider-validation identity/route checks protect
async stages; shared local/SSH selection-flag checks prevent defaults overriding the conversation.
Managed-account and internal relocation paths retain their existing authority checks.
Six-provider native-store fixtures exercise resume/supported-fork IPC with only PTY creation mocked.
This is automated handoff evidence, not live provider compatibility or geometry/redraw proof.
See [conversation-history-reliability.md](conversation-history-reliability.md).

## Provider research and unresolved proof

Installed CLIs inspected at this checkpoint: Claude 2.1.292, OpenCode 1.18.34, Codex 0.160.1.
No paid/live agent turns were run, and no synthetic prompts or continuation were introduced.
Automated fake-provider tests prove Clanker's transaction, **not provider compatibility**.

### Claude

`EnterWorktree` / `ExitWorktree`, `WorktreeCreate` / `WorktreeRemove` and `CwdChanged` are the promising
native route ([worktree documentation](https://code.claude.com/docs/en/worktrees)). Clanker already has
`CwdChanged` evidence. That does not establish a callable live-movement API from an outstanding Clanker
MCP call. A launch-owned hook integration must delegate creation/removal to Clanker's validated paths,
handle native entry/exit ordering, preserve user hooks/accounts, and prove subsequent tools in that
same turn use the new root. Existing `hot-replace` remains enabled; it preserves conversation, not turn.

### OpenCode

Installed version tag [`v1.18.34`](https://github.com/anomalyco/opencode/tree/v1.18.34), commit
`aec0b9a6d8898f68f923aaf08b7306d931fd9d76`:

- [`packages/core/src/control-plane/move-session.ts`](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/core/src/control-plane/move-session.ts)
  publishes native movement and checks destination project identity.
- [`packages/core/src/tool/bash.ts`](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/core/src/tool/bash.ts)
  resolves workdir through the active Location.

These are encouraging, but neither source inspection nor the existing transient-server stored-session
move proves the CLI's **already active** runtime receives movement from that other server. Its next
bash/read/edit tool, project resources and attention plugin must all follow the same location. Keep
`after-turn` until the active-MCP experiment below succeeds in both directions. Never send `moveChanges`.

### Codex

Installed version tag [`rust-v0.160.1`](https://github.com/openai/codex/tree/rust-v0.160.1), commit
`c3e23d4c4385619ecec78408766e46b7fa7dd9ad`:
[`ThreadSettingsUpdateParams.cwd`](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/app-server-protocol/src/protocol/v2/thread.rs)
is explicitly an override **for subsequent turns**. It is not proof of active-turn relocation. The
current CLI attachment also supplies no verified launch-owned control connection for updating its
shared app-server thread. Retain `after-turn`; do not invent Goals or auto-send continuation.

### Pi / OMP / Antigravity

Remain unsupported for checkout rehoming. Pi MCP attachment is already implemented (#113), but MCP
transport is not a live cwd/runtime primitive. No partial tool redirection, `process.chdir`, session-file
rewriting or session replacement from an active tool is introduced. See #118's Pi follow-up for the
upstream API investigation; any newer supported primitive needs an explicit provider experiment.

## Required native smoke before enabling a provider

Use a disposable repository/worktree and a normal user-requested root turn:

1. Record terminal ID, native root session ID, turn ID/epoch and process PID.
2. Request isolation during an active tool/MCP call; invoke the actual provider-native operation.
3. Capture authenticated root location evidence for the registered target, before MCP success returns.
4. In the **same** turn, use bash (`pwd`) and relative read/write tools. All must use the target;
   project instructions/resources must also follow it. Session, turn, process and terminal stay intact.
5. Move back to main in the same manner; only after proof may old-checkout cleanup run.
6. Repeat with child activity, denied movement, timeout, workspace close and dirty/ignored contents.
7. Verify bridge calls resolve the new checkout only after commit, and no prompts/config are injected.

## Still open

- #131 / former #118: native Claude hook integration and real active-turn OpenCode/Codex experiments. Enabling any live
  provider without these would misrepresent turn continuity and risk split-brain checkout authority.
- #131 / former #114: ordinary history-resume pane geometry is still unavailable before its new pane exists. Source
  geometry covers replacement resumes only. Long OpenCode/Pi visual smoke and a geometry-first ordinary
  resume handshake remain; no transcript renderer or bigger default buffer is introduced.
- #131 / former #116: partial-cache behavior, lifecycle integrity and ordinary default-account local
  handoff authority are covered, not the complete live local/SSH/removed-checkout resume/fork matrix.
- #91 dev services, #89 pages and #104 recovery UX are separate features, not prerequisites for this gate.

The existing large `isolatedCheckoutService.ts` remains the transaction integration point; new proof and
caller validation live in focused `liveRelocation.ts` / `liveRelocationCaller.ts` modules rather than
adding provider-native implementations there.
