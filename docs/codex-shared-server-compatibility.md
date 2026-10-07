# Codex shared-server compatibility (#107)

Clanker's launch-owned Codex attention and MCP attachments currently require **embedded mode**.
The startup warning remains visible. This is a verified compatibility fallback, not a fix that
restores shared-server operation with integrations enabled. With both integrations off, Clanker
adds none of these overrides and Codex makes its ordinary server-selection decision (user flags
or configuration can still select embedded mode).

## Evidence and supported alternatives

Checked 2026-10-06 against installed **codex-cli 0.160.1**, also the npm `latest` version reported
by `npm view @openai/codex version`. The matching upstream tag is `rust-v0.160.1`, commit
`d27764b82f7118f674371e6d6e76271d9d606edb`. Recheck this decision when upgrading Codex.

The [official configuration docs](https://learn.chatgpt.com/docs/config-file/config-basic)
describe config layers and profile files; the [hooks docs](https://learn.chatgpt.com/docs/hooks)
describe persistent `hooks.json`, inline hooks and installed plugin hooks. The
[app-server docs](https://learn.chatgpt.com/docs/app-server) describe a supported JSON-RPC
host integration with thread start, resume and fork operations. These are supported mechanisms,
but none was verified as a drop-in, launch-owned attachment for Clanker's existing native TUI.

The release source establishes the specific limitations:

- [`daemon_startup::config_exclusion`](https://github.com/openai/codex/blob/d27764b82f7118f674371e6d6e76271d9d606edb/codex-rs/tui/src/daemon_startup.rs#L54)
  permits only a small set of client/feature overrides. All `hooks.<event>`,
  `mcp_servers.<name>.*` and `developer_instructions` overrides fall outside that set. Any one
  of them selects embedded mode; moving `-c` around the command line doesn't solve it.
- [`daemon_startup::exclusion`](https://github.com/openai/codex/blob/d27764b82f7118f674371e6d6e76271d9d606edb/codex-rs/tui/src/daemon_startup.rs#L23)
  also excludes `--profile`. A generated `<profile>.config.toml` is therefore no workaround.
  [`loader_overrides_are_default`](https://github.com/openai/codex/blob/d27764b82f7118f674371e6d6e76271d9d606edb/codex-rs/tui/src/lib.rs#L1060)
  rejects custom user config paths/profiles as an ordinary shared-daemon launch.
- [`config_request_overrides_from_config`](https://github.com/openai/codex/blob/d27764b82f7118f674371e6d6e76271d9d606edb/codex-rs/tui/src/app_server_session.rs#L1808)
  filters the TUI's session overrides before sending thread requests to a remote server. Hooks
  and MCP servers are not forwarded. Forcing `--remote` would bypass server selection while
  losing the very attachments Clanker needs, rather than provide a supported solution.
- Persistent user/project/plugin configuration can load without per-launch overrides, but it
  changes configuration ownership and scope. Clanker credentials are different for each terminal,
  and hook commands resolve launch-specific resources through its child environment. A previously
  started shared daemon owns its own environment; the generated `ThreadStartParams`,
  `ThreadResumeParams` and `ThreadForkParams` schemas have no caller-process environment field.
  Consequently, simply writing shared config or installing a persistent plugin does not establish
  correct per-terminal credential/resource binding. This is an integration constraint inferred from
  those interfaces, not a claim that persistent Codex integrations are unsupported generally.
- A scratch `CODEX_HOME` changes the user's auth, history, config and daemon identity. It would
  replace native state rather than preserve the user's existing shared server. Clanker doesn't do it.
- A host-owned app-server client could supply per-thread configuration and consume lifecycle events,
  but would need its own UI/connection ownership, credential handling, native-session correlation,
  resume/fork proof and SSH design. Clanker's PTY-launched TUI doesn't expose a supported channel
  to hand it such a fully configured thread and preserve all existing behavior. This is future
  integration work, not a safe argv adjustment.

A bounded no-model TUI startup probe with isolated temporary homes remained in the loading screen
before the exclusion warning was rendered; it is not used as evidence of live integration success.
The fallback determination above comes from the matching release source and generated protocol
schemas. No real conversation, user daemon, user auth or user config was changed during investigation.

## Compatibility contract

Keep the existing launch-scoped `-c` attachments until a supported replacement is demonstrated.
Do not add `--no-daemon`, force `--remote`, rewrite `CODEX_HOME`, create a project config, or suppress
Codex's warning. A bare launch with attachments disabled stays unchanged.

Attention preserves the existing hook/profile conflict checks and native lifecycle interpretation.
The bridge preserves MCP-name and developer-instruction conflicts, reads its bearer token only from
the child environment, and leaves user servers/instructions intact. They remain independent
capabilities with separate credentials; turning off one doesn't require turning off the other.

Fresh, resume and fork launches retain top-level overrides before the subcommand. The resume directory
and same-conversation protections are unchanged. Local Windows hook commands still use their existing
native executable/path handling. SSH attention retains its remote launch-owned `-c` hooks and
OSC transport, so a remote Codex TUI has the same embedded-mode limitation. The desktop MCP bridge
remains local-only; no token is forwarded and no new remote helper or daemon is installed.

## Validation and future migration

`tests/main/unit/codexIntegrationCompatibility.test.ts` verifies the fallback's composition,
user-config preservation and environment-only MCP token reference for fresh, resume and fork launches
on local POSIX and Windows. Existing attention, bridge, session and remote launch suites remain the
behavioral coverage. `npm run validate` is the required final check.

Before claiming shared-server support, verify against a real supported Codex release that two
simultaneous launches have distinct attention/MCP credentials, an already-running daemon receives
the correct launch configuration, user hooks/servers/instructions and auth/history remain intact,
resume/fork keep correct identity and checkout roots, and termination revokes/removes only launch-owned
resources. Cover Windows and SSH (or explicitly limit the new mechanism), then add tests proving that
Clanker supplies no daemon-excluding top-level overrides on that verified path. Until then, the shared-server limitation remains.
