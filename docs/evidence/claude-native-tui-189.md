# Claude native interactive attention verification (#189)

## Outcome

Source baseline **8428d55**, installed Claude Code **2.1.304**, Linux, real PTY/TUI
and native hooks through normal Clanker launch preparation and the real broker.
No new Clanker runtime defect was demonstrated. This change adds repeatable native
verification, a shared deterministic Anthropic SSE helper and documentation; it
changes no production lifecycle/checkout authority.

The significant limit is confirmed rather than hidden: Esc cancels the native
model request, but the accepted hook stream supplies no interrupt/settlement event
in the observed window. Clanker retains Running, never claims successful
completion, and recovers on the next authenticated native prompt. This matches
the [documented Stop limitation](https://code.claude.com/docs/en/hooks-guide):
user interruption is not a Stop boundary. Terminal text, Escape input and HTTP
cancellation are not production lifecycle authority.

## Native verification

`npm run smoke:attention:claude-tui` runs installed interactive Claude, **not**
print/stream-JSON mode. It uses disposable HOME/XDG/Claude configuration and Git
state, a loopback Anthropic response fixture, and two actual native tools (Bash
and AskUserQuestion). Fixture-owned onboarding/trust preferences concern only
this known disposable directory. Tool permissions remain enabled: Bash is
explicitly configured to ask, and approval is entered through the real TUI.
There is no paid inference, user credential use, user profile modification,
remote connection or permission-bypass flag.

| Check | Verified result |
| --- | --- |
| Ten consecutive prompts | Each native UserPromptSubmit starts a fresh turn, publishes Running, then reaches a native provisional Stop. |
| Bash permission | Real PermissionRequest produces an approval wait. Enter approves the fixed read-only command; native PostToolBatch clears the wait and restores Running before Stop. |
| AskUserQuestion | Real PreToolUse creates an input wait; Enter answers the native question; PostToolBatch restores Running before Stop. |
| Manual `/compact` | Independent native PreCompact/PostCompact and SessionStart `source: compact` are observed. Native and broker session identity stay the same; no completion is invented. |
| Prompt after compaction | Fresh native prompt/turn and provisional Stop still track correctly. |
| Esc during a held model response | Native HTTP request cancellation is observed. During **1,000 ms**, the production stream contains only the turn's UserPromptSubmit, not a Stop/failure/interrupt settlement. Broker status remains Running and no completion exists. This does not prove indefinite behavior or termination of unrelated background tasks. |
| Prompt after interruption | A fresh native turn replaces the unresolved previous turn and reaches provisional Stop normally. |
| Completion/handoff safety | Every observed Stop leaves lastCompletion null and refuses handoff. No idle-time/key/output heuristic announces Done. |
| Configuration | The fixture's existing project settings remain byte-for-byte unchanged after additive injection. |
| Credential lifecycle | Attachment disposal revokes the credential; a deliberately late same-credential event is rejected. Native SessionEnd during teardown may also arrive as expected retired-credential traffic. |
| Cleanup | Only fresh run-tagged fixture processes are stopped and verified through the shared cleanup helper. All resource cleanup stages run even if another fails; failed private fixtures are retained. |

Native lifecycle observation does not parse TUI output. A separate fixture hook
records native event names, opaque session/prompt references, source/tool names,
child scope and two booleans confirming the known dummy Bash output/question
answer into a private bounded journal; public output omits the identities. Its
fixture-only PostToolUse observation never resolves production waits, which still
require PostToolBatch. Input/journal/output and HTTP request sizes/counts are bounded. Raw
terminal output is retained only as bounded private troubleshooting on failure.

## Shared fixture and regressions

`scripts/lib/anthropic-stream-fixture.cjs` emits deterministic text/tool Anthropic
SSE frames. Both the new TUI smoke and the existing Claude print-mode smoke use
it rather than duplicating streaming logic. Unit coverage checks text lifecycle,
escaped tool inputs, empty inputs, separate parallel block indices and compaction
summary/token-count overrides. These protocol unit cases are not native
parallel-tool or automatic-compaction evidence.

The existing `npm run smoke:attention:claude` still passes ten print-mode turns
and independent Stop-hook continuation through a real Read tool. Running resumes
in the same turn, every provisional Stop refuses handoff, and a fixture API error
never announces Done. Its missing StopFailure within five seconds remains an
explicit limit, not a new native success/failure claim.

Focused regression command:

```bash
npm run test -- tests/main/unit/anthropicStreamFixture.test.ts tests/main/unit/attentionProviderLifecycle.test.ts tests/main/unit/agentAttentionAdapters.test.ts tests/main/unit/agentAttentionBroker.test.ts
```

Result: **4 files / 181 tests passed**.

## Repeatable commands and scope

```bash
npm run build
npm run smoke:attention:claude-tui
npm run smoke:attention:claude
npm run validate
```

The PR records the final full-validation result; native smokes supplement rather
than replace that gate.

The new manual smoke requires Linux for verified run-tagged process cleanup and
loads only its fixed generated main modules with runtime createRequire. It
requires a prior build, but adds no static dist imports or baseline exemptions.
Both Fallow modes pass in a source-only archive without `dist/` (dependencies
linked separately), exercising CI's pre-build ordering.

`node scripts/claude-attention-tui-smoke.cjs --fail-after-launch` also exits with
the expected code 1 after real native startup, makes zero model requests, verifies
fixture cleanup, and retains only its private failed fixture for inspection.

This is not paid-provider behavior, automatic mid-turn compaction, all concurrent
permission/question batches, native Windows/SSH compatibility, built-Electron
indicator pixels, managed accounts, or resolution of the field crash in #196.
The result supplies the previously missing bounded Claude interactive evidence
for #189. Field incidents and deferred compatibility work must retain their own
explicit dispositions; this test alone does not complete the entire diagnostics
umbrella.

As in #223/#224, the pre-existing untracked
`scripts/claude-checkout-electron-smoke.cjs` is outside this change and is preserved
unchanged. Its independent unused global requires temporarily moving only that
file aside for lint/validation and restoring it via a trap. No lint/test/audit
rule is relaxed.
