# Hermes lifecycle audit — #187

## Scope and outcome

Read-only review on 2026-10-19, against Clanker `17daa80` (merged #212).
No active Assistant was opened, closed, reconnected or reconfigured. No profile,
chat, credential, installation or external process was modified. This is an
initial findings report, **not closure of #187 or proof of native lifecycle parity**.

The current process snapshot does not establish duplicate backends. It shows one
authenticated, Clanker-parented `serve`, two distinct native TUI/worker pairs, and
one additional Hermes-related Python process whose role remains unverified.
Multiple TUI/worker processes are not themselves duplicate backends or duplicate
viewers of the same chat. Session/attach identity was deliberately not extracted
from active user processes, so the two TUIs cannot be called either accidental
duplicates or proven independent conversations.

A disposable native startup failed before readiness; its exact child was confirmed
gone. Full startup/adoption/attachment/teardown tests remain blocked by that result.
Source review identifies a bounded-stop verification gap worth a focused follow-up,
but no native leak or causal link to model iteration exhaustion is established.

## Versions and evidence limits

- Installed `hermes --version`: `0.21.5+5751.g4097709`, upstream marker `6e7b83a2`.
  The installed source checkout is clean at `4097709b0ca`.
- This is **not** verification against the owner's previously reported 0.21.7.
- Installed `hermes serve --help` confirms headless `serve`, loopback binding,
  dynamic port `0`, and `--isolated`. No global `--stop` command was used.
- Installed source was inspected read-only. A long-running backend may have loaded
  earlier code; a clean checkout now is not proof of its in-memory implementation.
- No paid inference, real Desktop startup, live chat/PTY input, control-socket
  disruption, profile/session writes, Windows run or SSH run was performed.

## Live process/connection snapshot

Only command classes, parent/group/session relationships and listener ownership
were retained. Raw argv, environment values, tokens, paths, conversation content
and session IDs are omitted. Labels below replace actual PIDs.

| Label | Observed class / relationship | PGID / SID relationship | Listener / identity | Interpretation |
| --- | --- | --- | --- | --- |
| C1 | Existing Clanker main and Electron children | Existing app group/session | Not enumerated as Hermes listeners | Existing app left untouched |
| B1 | Python `hermes serve`, direct child of C1 | Shares C1's group/session | One IPv4 loopback TCP listener; private `serve` rendezvous matches PID/incarnation; authenticated `/api/host/identity` confirms role and protocol 1 | Clanker-parented backend; internal ownership bookkeeping not queried |
| T1 / W1 | Native Node TUI with Python gateway child, descended from B1 | T1 leads its own group/session; W1 shares it | No separate listening backend identified | Native TUI/worker pair; profile/session/attach identity unverified |
| T2 / W2 | Second native Node TUI with Python gateway child, descended from B1 | Separate T2-led group/session | No separate listening backend identified | Another TUI/worker pair, not evidence of a second `serve` |
| U1 | Hermes-related Python process outside B1's subtree | Separate group, different parent/session | No listening socket identified in the inspected TCP tables | Unknown role; neither blamed nor terminated |

The initial narrow command matcher missed B1 because its invocation uses a Python
entry point rather than a bare `hermes` argv token. The expanded read-only scan
included installed Hermes executable/script paths. **The expanded inventory above
supersedes that incomplete first scan.** This is still a point-in-time inventory,
not an exhaustive historical or multi-client ownership trace.

Read-only authenticated discovery used Clanker's built `readHermesRendezvous()` /
`discoverHermesBackend()` and a fixed host-identity GET. It returned `usable` and
matched the same one candidate. Tokens remained in memory and were not logged.
This demonstrates discovery of the existing backend, not a new Service instance's
adoption, reconnect, chat resolution or shutdown behavior.

## Disposable native startup

A separate Node driver called the built `spawnHermesServe()` and
`waitForServeReady()` with a fresh temporary HOME, HERMES_HOME, XDG directories and
private HERMES_GATEWAY_LOCK_DIR. The child environment retained PATH but no account,
attention, MCP or onboarding credentials. This separates the fixture from user
profiles and host rendezvous; no attempt was made to adopt or stop B1.

| Phase | Result |
| --- | --- |
| Spawn | One directly owned native child, same process group/session as the disposable driver (current Clanker spawn behavior) |
| Readiness | Child exited with code 1 before `HERMES_BACKEND_READY` |
| Sanitized failure | Dependency/bootstrap output; `ModuleNotFoundError` names `ruamel` |
| Cleanup | Exact spawned PID absent from `/proc`; fixture directory removed only after that check |
| Repeat | Same pre-readiness failure and verified child exit |

No raw native log was retained in the report. This is an **isolated-startup
blocker**, not proof that the user's existing backend is broken, nor a reason to
install/upgrade Hermes or modify its dependency environment without approval.
The fixture did not reach a state in which native profile, Bot Chat, attach-key,
Desktop-ordering or child-descendant shutdown behavior could be exercised.

## Source and existing regression findings

### Distinct process paths are intentional

- `src/main/harnesses/hermes/index.ts` launches the ordinary `hermes --tui` harness;
  it is independent of app-level Assistants and `serve`.
- `src/main/assistants/hermesDiscovery.ts` checks private user-scoped rendezvous,
  PID/incarnation, token fingerprint and authenticated host identity before adoption.
  A detected but inaccessible backend fails closed rather than knowingly starting
  a second one. This is discovery, not a cross-application startup lock.
- `src/main/assistants/hermesAssistantService.ts` coalesces refresh/open, checks
  generations, retains a live owned endpoint after RPC loss, serializes disable /
  re-enable behind its stop promise, and bounds automatic child restarts.
- Canonical chat lookup is `(profile, exact Bot Chat title)`. Only confirmed absence
  leads to create/title; a reported existing canonical chat cannot be silently
  replaced following an empty lookup. A title conflict attempts to adopt its winner.
- PTY attach uses stable `clanker-assistant-<slug>`, not a per-open random key.
  `reset()` closes viewers but intentionally keeps the backend; `shutdown()` is
  awaited in `src/main/main.ts` and stops only an owned child.

### Native PTY survivors are not automatically leaks

Installed Hermes source (`hermes_cli/pty_session.py`,
`hermes_cli/web_routers/chat_ws.py`, `hermes_cli/pty_bridge.py`, and
`hermes_cli/web_server.py`) describes:

- Keep-alive PTYs outlive their WebSocket, with an idle-detach TTL documented as
  30 minutes. The explicit registry key incorporates attach token, profile and
  canonical resume target. Different client keys can legitimately have different
  live PTYs for a conversation; equal conversation titles do not prove equal viewers.
- A newer viewer of the same key supersedes the old socket with code 4409.
- Native graceful backend shutdown closes the PTY registry. The PTY bridge records
  its separate group and attempts group cleanup, not merely leader termination.
- These are source contracts, **not a successful live reattach/teardown test**.
  Killing the backend abruptly can bypass its graceful registry shutdown.

### Remaining owned-stop risk (source finding)

`spawnHermesServe()` does not create a dedicated POSIX group. `killChild()` sends
SIGTERM to the direct child, waits for exit or a grace deadline, and then sends
SIGKILL if `exitCode` is still null. It does **not** wait for an exit acknowledgement
after SIGKILL or verify native descendants. `stopOwnedChild()` clears its child
reference before this bounded attempt completes. Failed-start cleanup also clears
its reference after that attempt.

Consequently the stop promise is not a verified termination guarantee. A failed
signal or incomplete kill can lose ownership bookkeeping and permit later discovery
or startup without proving that all owned resources are gone. Native PTYs have
separate groups, so merely adding a backend process-group kill would not by itself
prove descendant cleanup. Node also keeps `exitCode === null` for signal exits;
exit-event/signal state should be considered in any fix.

This is a concrete control-flow gap, **not a reproduced native orphan**. Existing
tests that hold SIGTERM open release the child before the long grace expires; they
do not prove failed/unacknowledged SIGKILL handling or native descendant cleanup.
Do not introduce a broad process scavenger or kill an adopted/external backend.

## Automated verification

`npm run test -- --run tests/main/unit/hermesAssistantService.test.ts tests/main/unit/hermesBackend.test.ts tests/main/unit/hermesDiscovery.test.ts`

Result: **3 files / 92 tests passed**. Coverage includes disabled/dormant behavior,
authenticated adoption, never stopping external backends, startup timeout/output
bounds, retry coalescing, host appearing during startup, bounded crash restart,
rapid disable/re-enable, RPC loss with a retained owned child, canonical lookup and
stable attach identity. These are fixture tests, not native Desktop evidence.

## Smallest next steps / remaining acceptance

1. Resolve the disposable startup dependency/environment blocker with approval,
   without changing active profiles/chats. Record the actual tested Hermes version;
   do not assume 0.21.7 or upgrade as part of diagnosis.
2. In that working isolated fixture, exercise owned startup, adoption-only startup,
   competing startup, control loss/Retry, stable-key reconnect/supersession,
   disable/re-enable and graceful/forced stop. Record process and native session /
   attach identity comparisons without publishing their raw values. Use real Desktop
   ordering only in an explicitly isolated Desktop fixture or with user approval.
3. Prioritize a **focused owned-stop fix and regressions**: verify the exact child's
   exit after escalation, retain failed/unverified cleanup ownership, block replacement
   while cleanup is incomplete, and keep stop retryable. Verify native descendant
   behavior before selecting a process-tree mechanism; never signal external owners.
4. Reconcile U1's role and whether T1/T2 represent distinct intended viewer keys only
   if that can be established read-only without extracting chats or disrupting them.
5. Keep #187 open. Nothing here connects Clanker's process lifecycle to the reported
   Hermes Desktop iteration limit, model choice or failed tool calls.
