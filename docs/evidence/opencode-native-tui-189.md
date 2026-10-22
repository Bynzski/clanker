# OpenCode 2.x native TUI attention (#189)

## Reproduction and fix

Source baseline: `5b197a7`. Installed `@opencode/cli` **2.0.26** on Linux.
The upstream tag `v2.0.26` resolves to **9b4ec5714d481559990db0a816d5dec19541a814**;
its native plugin, TUI router/data, configuration, shell/question and event contracts
were inspected, rather than applying legacy 1.x assumptions.

A disposable real-PTY TUI test reproduced a product defect:

1. Repeated root executions, a real shell permission prompt/reply, a real question
   form/reply and double-Esc interruption all reached the real Clanker broker.
2. Native `/new` created another conversation and successfully executed a turn.
3. Clanker's server observer reported its `session.execution.started` and
   `session.execution.succeeded`, but the shared-session guard rejected both as
   `rejected-mismatch`. Clanker remained bound to the old conversation.

The guard was correct: a new server root does **not** prove which conversation the
TUI selected. It is not weakened by this fix.

For verified interactive argv, the launch-owned additive plugin now has a native
TUI entrypoint and a no-op server entrypoint (one lifecycle publisher, no competing
server/client streams). Native `ctx.ui.router.current()` plus root metadata from
`ctx.data.session.get()` proves selection. Selection and native `ctx.data.listen()`
events enter one serialized queue. A selected root change uses the existing explicit
`session_replaced` event naming the exact old root; its diagnostic native label is
`tui.session.selected`, derived from that native client state.

The common 2.x interpreter retains per-root epochs/parentage. Background events
update that bounded state without publishing as this terminal's root. A bounded
cache of native lifecycle/request identifiers can restore an active selected turn
or a fast first turn while root metadata loads in the same native selection.
Native route epochs distinguish that case from historical/auxiliary completion,
including a previously unseen idle root. Home navigation and viewing a child of
an already-bound root keep that root's real lifecycle live; child identity never
replaces it. Returning to an idle root does not
reannounce a past completion. Resolved waits are compacted out; cached records
omit tool/prompt/error bodies. New observer instances use fresh turn nonces even
when a TUI plugin reload reuses its imported core module.
Children, unavailable metadata and unrelated server session creation cannot select
a root. Disposal drops queued work and suppresses late asynchronous lookup results.

Known ordinary launch/resume/prompt/auto/logging flags get the TUI entrypoint.
Unknown flags, positional/subcommands and noninteractive argv retain server-only
observation; no client-selection support is claimed for them. User-selected servers
or `OPENCODE_CONFIG` still decline injection. Legacy 1.x, SSH, launch bindings,
checkout authority, MCP credential identity and the shared broker are unchanged.

## Repeatable native test

```bash
npm run build
npm run smoke:attention:opencode-tui
npm run smoke:bridge:opencode
npm run test -- tests/main/unit/openCodeTuiAttention.test.ts tests/main/unit/attentionProviderLifecycle.test.ts tests/main/unit/agentAttentionAdapters.test.ts tests/main/unit/attentionBridgeTransaction.test.ts
npm run validate
```

The new smoke uses the installed TUI over a real `node-pty` PTY, normal launch
attachment preparation, real broker and actual native plugins/events. It creates
only disposable HOME/XDG/configuration/Git state. A bounded loopback
OpenAI-compatible fixture drives the real native shell/question tools; no paid
inference, user credentials or user conversation/worktree changes. The v2 fixture
uses `providers`/`settings`, native `shell`, and ordered `permissions`, not the
legacy `provider`/`options`/`bash` configuration.

Verified outcomes:

- **Ten consecutive turns**: native Running and completion, with current cwd provenance.
- **Permission**: native shell ask → approval wait → Enter reply → Running → completion.
- **Question**: native form creation → input wait → Enter reply → Running → completion.
- **Interrupt**: double Esc → native interrupted outcome, then a successful subsequent turn.
- **`/new`**: native command, changed root, successful first and second turns without mismatch.
- **Resume**: new private TUI launched with native `--session` and authoritative resume binding;
  next turn tracks the original session.
- **Exit**: fixture-owned processes cleaned; disposing the attachment revokes its credential;
  a deliberately late same-credential event is rejected as retired authentication.
- **Configuration**: fixture's existing config is byte-for-byte unchanged after additive injection.
- **Bridge regression**: real 2.0.26 TUI still discovers authenticated MCP tools with attention
  disabled, makes zero model requests, preserves config and revokes the bridge credential.

Focused coverage totals **4 files / 189 tests**, including the actual generated core/TUI
sources with only the external reactive scheduler stubbed, the real broker, explicit
selection/epoch/request handling, fast events before metadata, seeded resume,
A→B→A ordering, delayed reactive selection, child/unknown exclusion, background
completion, compacted long-turn waits, plugin reload, disposal and argv injection
scope. Existing server and 1.x lifecycle fixtures remain covered.

Full `npm run validate` passed branding, lint, typecheck, full/production Fallow,
security-check (zero high/critical; the existing 12 moderate findings remain),
build and **426 files / 8,245 tests**. The unrelated untracked fixture described
below was temporarily moved aside and restored unchanged for lint/validation.

## Clean-source CI ordering

The initial CI run caught four unresolved static imports from this manual smoke
into generated `dist/main/main` files: CI runs Fallow before build, whereas the
local checkout already had those artifacts. The smoke now uses a runtime
`createRequire` rooted at the generated main entrypoint, consistent with its
explicit after-build execution requirement. No baseline exemptions or workflow
ordering changes were added. Full and production Fallow checks pass in an archived
source-only checkout with no `dist/` directory (dependencies linked separately),
and the native smoke still runs against the built modules.

## Limits and issue disposition

This is native standalone TUI/PTY/broker evidence, not built-Electron pixel evidence,
real-provider inference, Windows or SSH compatibility. It does not add startup-model,
TUI-fork, AI-commit or remote 2.x support. Existing explicit guards remain in force.
The native resume test uses `--session`, not the interactive session-picker UI.

This resolves the demonstrated OpenCode `/new` defect and supplies the missing live
permission/form/interrupt/resume evidence for that bounded sequence. Keep #189 open
for its remaining Claude interactive checks, field-capture questions and other
separately unresolved findings. No claim is made to fix the native crash in #196.

The owner's pre-existing untracked `scripts/claude-checkout-electron-smoke.cjs`
remains unchanged and is not part of this work. As in #223, its independent unused
`document` global requires temporarily moving only that file aside/restoring it for
repository lint/validation; no lint rule or security gate is relaxed.
