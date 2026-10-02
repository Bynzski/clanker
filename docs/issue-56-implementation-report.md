# Issue #56 implementation and verification

Branch: `issue-56-ssh-browser-auto-preview`. This change does not include issue #50 pane placement, dragging, hide/restore or tab-chrome work.

## Architecture

- `sshPortDiscovery.ts` executes one bounded ephemeral Python command using host `ss`/`lsof`, with an eight-port fallback only when neither tool exists. At most 32 loopback endpoints are probed, four concurrently. Each HTTP/HTTPS attempt has a 700 ms deadline and reads at most 512 status bytes; tool output and SSH response sizes are capped. No remote installation, custom daemon or remote LAN scan is introduced.
- `RemoteServiceDiscovery` shares listener inventories across resolved SSH transport identities. Browser leases start/stop discovery; a one-minute adaptive startup burst backs off to one scan per minute. Terminal hints and explicit refresh accelerate/coalesce scans. Canonical process cwd establishes workspace ownership; unknown ownership requires selection.
- `RemotePreviewManager` owns independent service forwards keyed by workspace/address/port/protocol, capped at four per workspace and sixteen globally. Main allocates desktop ports and retries OpenSSH bind races. Owned children use system OpenSSH `-N` and bind only desktop `127.0.0.1`.
- SSH listener readiness is independent of HTTP readiness. Health checks use the existing forward, not fresh SSH commands. Refused service connections enter waiting state and recover on the same tunnel; SSH policy rejection/disconnect is a distinct friendly transport error. Shutdown aborts pending starts and waits for owned children; failed cleanup retains ownership for retry.
- Browser exposes detected services, automatic opening of one workspace-owned service, explicit selection for ambiguity and a manual remote-port/protocol fallback. Local ports are never renderer input. Hidden/background panes release discovery and cannot receive late navigation. Ready/recovered services reopen when their selected Browser becomes relevant again.
- Both new and resumed SSH PTYs feed filtered output into a per-terminal bounded line parser using the existing shared HTTP(S) URL parser. Split chunks, ANSI/OSC, oversized rows, credentials and non-loopback URLs cannot supply inappropriate hints. Output signals alone do not start idle scanning.

## Validation and live evidence

Focused tests passed for discovery, host HTTP/HTTPS probes, lease/backoff/cancellation, port allocation, forwarding policy/errors, restart recovery, cleanup retry/caps, IPC validation, filtered PTY signals, Browser/tab lifecycle and localhost normalization.

Final `npm run validate`: **4,445 tests across 214 files**; branding, lint, typecheck, audit and build passed, with zero audit vulnerabilities.

Safe live SSH checks used the established test host and a unique empty temporary directory. Foreground fixture HTTP servers exercised real `ss`/PID/cwd ownership, IPv4 and IPv6 discovery, an occupied preferred desktop port, a tunnel established before the service was running, delayed startup, same-tunnel server restart, two simultaneous forwards, awaited child cleanup and local listener release. Fixture servers and the temporary directory were removed; `clanker-test/README.md` was preserved. No model inference was submitted.

This was a backend live smoke, not a live Electron visual acceptance run. HTTPS probing uses a self-signed local test fixture; the live host smoke used HTTP. Real forwarding-policy rejection was tested with mocks, without changing the shared host's SSH policy. Windows/macOS native OpenSSH and framework-specific Browser runs remain manual acceptance checks.

## Deliberate limits and review focus

- One foreground OpenSSH process per managed service is retained; no ControlMaster/proxy redesign. Stable discovery is minute-scale unless an output signal or explicit refresh accelerates it. The candidate cap can omit listeners on unusually busy hosts; terminal hints are prioritized.
- Automatic preview requires one high-confidence service and an active Browser. Multiple or unscoped services need explicit selection. Process names are reported as supplied by the listener utility (often `node`), not guessed framework labels.
- Terminal output hints identify endpoints; URL-click rewriting/path preservation is not added. Existing terminal link behavior is preserved. A future scoped enhancement could open the exact printed path through a selected forward, especially with multiple services.
- Manual fallback defaults to remote IPv4 loopback; discovered IPv6/wildcard listeners carry the appropriate destination. Privileged ports, persisted forwarding preferences and automatic reconnect after a genuine SSH transport failure remain outside this change. Service restarts do recover automatically.
- Development TLS is accepted only for bounded discovery/health probes. Browser certificate validation is unchanged.
- Review listener/probe limits and source ownership, OpenSSH log classification, allocation handoff retries, lease/registration identity checks, selected-tab navigation races and cleanup during pending startup. Full Browser chrome/layout redesign remains issue #50.

## Corrective review: Browser isolation and fresh discovery

All Browser tabs in a registered SSH workspace now use a private, in-memory Chromium session. Other SSH workspaces cannot inherit its cookies, localStorage or cache, including hostname-scoped loopback cookies across different ports. Tabs within one SSH workspace share state. Local workspaces retain `persist:browser-global` and existing persistent logins. Ordinary browsing inside an SSH workspace intentionally also uses that workspace's private session; it does not inherit global logins, and closing the workspace clears its session. Switching partitions only for preview URLs would require replacing views on navigation/redirects and preserving tab history, so this broader workspace boundary is the smallest robust solution.

New discovery leases never bootstrap from cached ownership. The last lease for a workspace clears its published inventory even if a sibling workspace keeps the shared host scanner alive. Results target the consumer identities captured by their scan; removed/recreated consumers require a fresh scan. The active Browser bootstraps only through WATCH, not a racing GET. Forward lifecycle state remains available independently of discovery inventory.

`ssh-preview-session-smoke.cjs` passed against actual Electron/Chromium: cross-workspace cookies/localStorage were absent, same-workspace tabs shared state, and differing localhost ports did not provide cookie isolation on their own. Targeted unit/renderer tests, typecheck and lint passed. The script uses a disposable profile and local fixture, without disabling sandboxing or certificate security.
