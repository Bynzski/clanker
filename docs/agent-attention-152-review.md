# Issue #152: attention delivery review

## Checkpoint 1 — local ACK contract

Source reviewed and contract tests run on October 9, 2026. This checkpoint fixes shared
local delivery and its serialized hook recovery. It does **not** establish the root cause
of every reported missing indicator or complete issue #152.

### Observed loss stage

The loopback server formerly returned `ok` after every complete message, irrespective of
parse, authentication, transport or root/turn correlation. The observer interpreted that
as successful delivery. The serialized command could therefore clear its conservative
poison marker on a boundary the broker had rejected or ignored.

A concrete regression exposed this: the existing corrupt-state recovery test interrupted
`t1`, then attempted recovery by starting `t1` again. The broker retained `t1` as retired
and ignored the new start, yet the old unconditional ACK cleared poison. With truthful
ACKs the same test retains poison until a fresh accepted `t2` start. This proves a false
recovery at the transport/bridge boundary; it does not prove the native field symptom.

### Change

The local reply is one versioned line, `clanker-attention-v1:<verdict>\n`, with a fixed
vocabulary and a 96-byte intake bound:

| Verdict | Bridge behavior |
| --- | --- |
| `accepted-changed` | Accepted; an accepted turn/session-end boundary may recover poison |
| `accepted-idempotent` | Accepted duplicate; same boundary rule |
| `ignored-child`, `ignored-stale` | Harmless; neither poison nor recover |
| `rejected-invalid`, `rejected-auth`, `rejected-transport` | Failed delivery; poison lifecycle transaction |
| `rejected-mismatch`, `rejected-ambiguous` | Failed identity attribution; poison lifecycle transaction |
| Missing, unknown, truncated, oversized, old `ok`, or timed-out ACK | Failed delivery |

The provider-facing `emit` boolean remains true only for accepted events. The serialized
command asks for the detailed verdict. Read/interpret/write/deliver remains under its
existing exclusive lock. There are no retries, identity relaxation or fallback detectors.
Lost location-only reports retain the existing exemption from lifecycle poison.

The observer handles fragmented ACKs and uses a 500 ms total deadline, so a trickling
peer cannot extend the transaction by resetting an inactivity timeout. Oversized requests
are disconnected without an ACK. ACKs contain no credentials, paths or provider content.

Broker decision diagnostics now include the exact delivery verdict alongside terminal,
semantic event, revision and status. Existing `CLANKER_DEBUG_ATTENTION=1` logging also
reports parse/auth/transport rejection reason codes without echoing incoming data.
This is the broker/transport portion of diagnostics; attachment, renderer visibility and
IPC delivery diagnostics remain to be implemented. No new public diagnostics IPC exists.

### Evidence and limits

- Real child Node processes run the generated observer and serialized hook command
  against an actual loopback socket and broker, including overlapping transactions.
- A real observer/socket/broker path feeds the canonical change payload into the actual
  renderer attention store and presentation selector: start, duplicate, wrong root,
  ambiguous identity, child completion, completion/acknowledgement, second start, stale
  completion, proven session continuation, completion and authoritative retirement.
  Hydrating an older snapshot after retirement cannot resurrect it.
- Protocol regressions exercise malformed/sensitive payloads, authentication, local/remote
  transport separation, fragmented/unknown/truncated/oversized/legacy ACKs and a trickling
  peer. Hook regressions prove ignored boundaries cannot clear poison and a fresh accepted
  boundary can recover without restarting.
- The snapshot callback in this integration test is the IPC payload boundary. Electron
  IPC, mounted UI, workspace switching and actual upstream CLI emission are **not** tested
  by it. Fixtures do not prove native hooks fire.
- SSH remains one-way OSC over the existing PTY. Its observer's boolean means a successful
  tty write, **not** broker acceptance. No desktop ACK, endpoint or credential is forwarded.
  Remote broker intake returns the same verdict vocabulary for main-side diagnostics/tests.

## Native inventory and remaining checkpoints

Only `--version` was run for this checkpoint; **no model inference or native lifecycle
smoke run has been performed**. Use free or low-cost models for subsequent native checks.
Do not modify user-owned hooks/profile configuration to force coverage.

| Harness | Installed version | Native coverage in this checkpoint |
| --- | --- | --- |
| Claude | 2.1.296 | Pending |
| Codex | 0.162.0 | Pending |
| Pi | 1.1.0 | Pending |
| OMP | 18.4.10 | Pending |
| OpenCode | 1.18.34 | Pending |
| Antigravity | 1.3.2 | Pending |
| Hermes | 0.21.5+5751.g4097709 (upstream 4097709b) | Pending; local attention currently unsupported |

Next checkpoints:

1. Report requested versus actually attached native sources, including unavailable/conflict
   reasons, across local and SSH launch paths. Preserve user configuration.
2. Extend safe diagnostics through IPC/store/presentation and audit workspace membership
   retirement. Simple workspace switches have not been shown to remove terminal membership;
   do not call that hypothesis a reproduced race or change retirement on that assumption.
3. Verify versioned upstream contracts and native repeated-turn/session-boundary behavior.
   Prioritize OMP stop continuation, Hermes local capability/SSH interruptions, Claude large
   tool batches/human waits, then Pi replacement, Codex compaction, OpenCode abort/error and
   Antigravity outcomes. Keep strict root authority and a single main broker.
4. Run the Electron four-workspace/background/hidden-pane matrix and local/SSH native smoke
   matrix. Record unavailable hooks for the user's local smoke pass explicitly. The issue's
   full acceptance matrix remains open until these checks and independent review succeed.

No PR or merge is part of this checkpoint.
