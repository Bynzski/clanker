# Vite security gate remediation (#222)

## Change and scope

Source baseline: `5774c3c`, with the local #192 verification additions preserved.

- Raise the Vite manifest floor from `^8.0.8` to `^8.1.6` and lock **8.1.6**
  (previously **8.1.3**). This is the smallest patched release in the current
  minor line for [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm)
  and the accompanying editor/development-server advisories reported by npm.
- The high-severity finding concerns Windows editor middleware; this dependency
  finding does not establish exploitation or a packaged-renderer exploit.
- Update only the required dependency closure: Rolldown/bindings **1.1.5**,
  Oxc types **0.139.0**, and Picomatch **4.0.7**. Retain existing optional WASM
  runtime/util versions within their supported dependency ranges; the incidental
  newer WASM runtime would introduce a Node 22.13 engine floor.
- React plugin **6.0.1** and Vitest/coverage **4.1.11** stay unchanged and accept
  Vite 8 in their published peer ranges. Vite/Rolldown retain Node 22.12 support.
- No audit exceptions, force-fixes, packaging downgrades, security policy changes,
  application version changes, or runtime behavior changes.

## Verification

- `npm ci`: clean install passed with the updated manifest/lockfile.
- `npm ls vite`: React plugin and Vitest deduplicate to **8.1.6**.
- `npm exec --yes --package=node-linux-x64@22.12.0 -- node --version`:
  **v22.12.0**, followed by a successful renderer build using that exact binary:
  `npm exec --yes --package=node-linux-x64@22.12.0 -- node node_modules/vite/bin/vite.js build`.
  The ordinary `node` npm package's install script was not enabled; the platform
  binary package makes the runtime check explicit without changing script policy.
- `npm run security-check`: passed, **zero high/critical**, **12 moderate**.
- `npm run smoke:attention:claude-checkout-electron`: passed with native Claude
  **2.1.304**, freshly built Electron **41.10.7**, isolated repos/profile and
  deterministic loopback responses. Checkout/Git/Explorer recovery, unavailable
  scratch observations, workspace switching/refocus and saved-workspace restart
  remain correct. Print mode with fixture stdin pipe, not real inference/TUI.
- `npm run smoke:checkout-presentation`: passed with real Electron/Git/PTY,
  main plus linked worktrees, agent focus, dirty counts, historical/unregistered
  observations and unchanged launch authority; native cwd reports are fixtures.
- Initial `npm run validate`: passed branding, lint, typecheck, both Fallow
  checks, security check, build and **423 test files / 8,135 tests** on Node
  **26.11.1**. After rebasing the PR onto main **`0e5f1cd`**, the complete pipeline
  passed again with **425 test files / 8,212 tests**; both built-Electron checkout
  smokes also passed again on that combined source.

### Working-tree caveat

The unrelated, pre-existing untracked
`scripts/claude-checkout-electron-smoke.cjs` still has an unused `document`
global. Validation was run with **only that file temporarily moved outside the
repository**, using a shell trap to restore it. It remains byte-for-byte unchanged;
no lint rule or test was skipped/relaxed. Thus the dependency gate and the relevant
change set validate, but ordinary lint of the restored entire working tree still
fails on that independent file until its owner resolves it.

## Remaining moderate findings

The audit still reports **12 moderate package findings**, not twelve independent
root vulnerabilities:

- Vitest/mocker/coverage chain: mock-registration and redirect traversal
  advisories. These test-tool findings remain out of this narrow Vite change.
- Electron **41.10.7**: HID/USB permission checks may be attributed to the wrong
  origin ([GHSA-fw47-9c62-h3vw](https://github.com/advisories/GHSA-fw47-9c62-h3vw)).
  Electron is the shipped runtime even though npm declares it as a development
  dependency; this is **not** dismissed as build-only or declared unexploitable.
  A runtime upgrade/exposure assessment needs separate compatibility work.
- `sprintf-js` and its electron-builder-related ancestor chain: unbounded precision
  denial of service. Do not accept npm's suggested builder downgrade, which would
  reintroduce the separately documented AppImage risk in `RELEASING.md`.

No moderate finding is treated as an advisory exception: the unchanged project
policy fails on any high/critical finding. Further remediation remains separate.
