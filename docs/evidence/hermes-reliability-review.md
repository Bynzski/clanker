# Hermes Assistant reliability review — #194, #187, #182

## Scope and decisions

| Ticket | Evidence in this checkout | Outcome |
| --- | --- | --- |
| #194: terminal clipboard | AssistantTerminal loaded only FitAddon, with no selection listener or copy key handler; TerminalPane already had all three clipboard mechanisms. | Fixed: load ClipboardAddon and share selection/shortcut logic with workspace terminals. |
| #187: backend/PTY lifecycle | Existing tests exercise external adoption, failed-startup cleanup, overlapping enable/disable, bounded restart, control recovery, canonical title races and coalesced PTY opens. Child termination signals the exact owned PID, not a separately owned/verified process group. | No backend ownership change. Unit coverage does not establish native descendant cleanup or Desktop coexistence. A renderer late-open teardown race is fixed separately below. |
| #182: local metadata and cron | PRs #183 and #184 are merged. Native title/tagline editing, safe avatar reads and default-profile cron visibility exist in production code. | Do not rebuild them. SSH inventory remains deferred; see the pinned source investigation below. |

This is not evidence that Clanker caused a Hermes model/tool-loop failure. Ordinary
`hermes --tui`, an owned `hermes serve`, an adopted Desktop backend, and a detached
native chat TUI are distinct process classes, not duplicates merely because their
executable names match.

## Clipboard behavior and regression coverage

`src/renderer/lib/terminalClipboard.ts` owns the shared copy semantics:

- Nonempty selections copy through the existing preload clipboard bridge.
- Ctrl+Shift+C is consumed even with no selection; only keydown writes, avoiding
  duplicate writes on keyup/keypress. Copy clears the selection as before.
- Plain Ctrl+C is not intercepted and can still send the normal PTY interrupt.
- An inactive/disconnected Assistant does not copy or accept keyboard events. The
  live ref updates without recreating xterm or reopening Bot Chat. Native xterm
  query replies still flow through onData during startup and while parked.
- Selection subscriptions are disposed with the terminal. The existing addon is
  loaded; no new clipboard permission, IPC, shell command or dependency is added.
- Hermes mouse reporting is unchanged: the terminal tooltip and harness guide
  explain Shift+drag for native xterm selection.

Renderer regressions cover addon loading, selection copy, shortcut consumption,
empty selections, keyup, plain Ctrl+C, parking/disconnect/recovery and disposal.
The existing workspace copy regression exercises the same helper.

### Late open after unmount

The mount callback awaits `openAssistant()` before creating ResizeObserver. Cleanup
could run during that wait, dispose xterm, then the continuation could create an
observer after cleanup (or attempt to observe a cleared host). It now checks both
cancellation and host availability after the await. The regression deliberately
holds the open promise, unmounts, then resolves: no late replay or new observation,
and both terminal and selection subscription are disposed. This is a renderer
resource-lifetime fix, **not** proof of a backend/session/process leak.

## Lifecycle audit boundary (#187)

Reviewed `hermesBackend.ts`, `hermesDiscovery.ts`, `hermesAssistantService.ts` and
its existing focused tests. No additional native backend or Desktop was started,
no live user chat was attached, and no user profile, setting or credential was
changed for this review. Installed-version compatibility, process-group cleanup,
4409 behavior with real competing clients and native detached-TUI retention remain
**unverified**. No process inventory, native connection/session matrix, or claim of
real Desktop coexistence success is supplied by these mock-backed tests.

In particular, `killChild()` sends SIGTERM to the owned child and escalates to
SIGKILL after its grace period. It does not independently prove descendant exit
or wait for a post-SIGKILL exit acknowledgement. The source-level limitation does
not establish that native Hermes leaks: native shutdown and ownership must be
measured before changing this contract. Do not kill a shared/inherited process
group or scavenge other Hermes processes to compensate.

### Remaining owner-approved native smoke

Use disposable profiles/configuration, no prompts/model turns and no scheduler
execution. Do not toggle the owner's real autostart settings or active chats.
Capture only sanitized process identity and counts, never tokens, URLs with query
credentials, command-line secrets, transcript text or private profile paths.

| Scenario | Evidence to record | Required distinction |
| --- | --- | --- |
| Desktop first, Assistants off / adopt-only / autostart | Application class; PID/PPID/PGID/SID/start time; listener owner; authenticated rendezvous role/PID; owned-child count | Disabled does nothing; adopted Desktop remains external and is never terminated by Clanker. |
| Clanker first, then Desktop; overlapping startup | Same identity fields before/after, backend and native TUI counts | A second application or TUI is not automatically a second backend. Record actual version and host identity. |
| Open twice, park/reopen, explicit PTY reconnect | Canonical session equality and attach-key equality (report equality, not raw IDs), TUI count | Same-chat reconnect versus intentional independent viewer key; real 4409 supersession versus accidental duplicate. |
| Control drop/Retry; fast disable/enable; owned crash | Before/after backend identity, owned restart count, socket state | Reuse live owned child; bounded restart; no stale late surface. |
| Window close, quit, graceful/forced child exit | Owned PID and verified descendant survivors, connection closure, subsequent reattach result | Owned service versus external backend versus intentional detached native TUI versus unknown survivor. Forced app kill cannot promise graceful cleanup. |
| Ordinary Hermes harness alongside both apps | Command class and native session identity | Normal --tui launch remains independent of the Assistants service; no claim about effective provider/iteration limits without native evidence. |

Repeat on Linux first; Windows/macOS results must be reported separately, not
inferred. Keep #187 open until this native matrix is populated or explicitly
bounded by the owner. File a focused follow-up for any reproduced backend defect.

## Remaining #182 work

The recorded investigation is version-pinned, not a new claim about today's
installed Hermes or every future release:

- [SSH discovery prerequisites](hermes-ssh-discovery-182.md): no permanent human
  CLI-table parser, raw directory scanner, runtime bootstrap or implicit daemon.
  Recheck upstream for a supported read-only one-shot inventory contract before
  implementing. Inventory must use source-environment + canonical-profile identity
  and must never imply remote chat connectivity.
- [Native profile presentation](hermes-profile-presentation-182.md): merged #183;
  read fallback and CAS-preserving cosmetics exist. Avatar upload remains deferred.
- [Cron visibility](hermes-cron-visibility-182.md): merged #184; default-profile
  jobs have a read-only Settings destination, but no Assistant identity/PTY.
  Scheduler health remains Unknown; no scheduler writes or triggers.

Older integration evidence describes PRs #183/#184 before merge; preserve it as
historical evidence, not their current GitHub state. #182 remains open for the
remaining prerequisites, not for reimplementation of merged local features.

## Validation

Focused command:

```sh
npm run test -- tests/renderer/unit/Assistants.test.tsx tests/renderer/unit/TerminalPane.test.tsx tests/main/unit/hermesAssistantService.test.ts tests/main/unit/hermesDiscovery.test.ts tests/main/unit/hermesBackend.test.ts
```

`npm run validate` passed in this checkout: branding, lint, typecheck, full and
production Fallow regression checks, security audit, build, and all **412 test
files / 8,009 tests**. This includes the focused files above. Automated checks
cannot substitute for the native Desktop/process matrix or external-application
clipboard paste smoke.

Manual clipboard acceptance: open a disposable Assistant, select text with
Shift+drag, paste into an external editor, then repeat with Ctrl+Shift+C. Confirm
plain Ctrl+C still interrupts, and park/reopen preserves the same surface. This
physical clipboard/TUI check has not been performed as part of this review.
