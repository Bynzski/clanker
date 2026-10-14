# Issue #182 — Phase 2: native local profile presentation

## Shipped scope

Settings → Agents & AI → Assistants retains the existing profile selector, hiding,
service controls and independent read-only details sections. The selected local
profile now has a **Bot appearance** section with its stable `hermes:<slug>` ID,
native avatar, Bot title and Bot tagline. Visible roster/rail/strip rows use the
same avatar component. Missing, unsupported, invalid or offline art has a neutral
profile-glyph fallback; it never nominates a URL or implies a new connection.

The **only new native write** is `profiles.configure` with
`ui_meta['hermes-bots'].title` and `.description`, plus the namespace's expected
revision. No profile rename, operational description, SOUL, configuration,
credential, model, skill/MCP, cron or chat mutation was added. No local alias or
new persistent settings schema was added. Existing chat IDs, profile cwd and
Assistant/browser ownership remain independent of cosmetic labels.

Remote inventory remains deferred. Phase 1's proposed upstream one-shot,
side-effect-free JSON inventory contract is now approved as the prerequisite;
there is still no CLI-table parser, SSH adapter, remote service or helper.

## Verified upstream contracts and compatibility

Source reviewed at upstream
[`0e427d788d253630d38a3a51cd76849e73cd6925`](https://github.com/NousResearch/hermes-agent/commit/0e427d788d253630d38a3a51cd76849e73cd6925),
the same HEAD as Phase 1. Installed source used for the native smoke was
`6e7b83a2f1c093e992a8d838ed77ea320fbd8e51`, described as
`v0.21.7+canary.20261013T070740Z-216-g6e7b83a2f1c`.
Its `tui_gateway/methods_profiles.py` was byte-identical to the reviewed file.
Support is feature-detected, **not** assumed from a version string.

- [`profiles.list`](https://github.com/NousResearch/hermes-agent/blob/0e427d788d253630d38a3a51cd76849e73cd6925/tui_gateway/methods_profiles.py#L258-L306)
  provides `ui_meta`, `ui_meta_revisions` and `has_avatar`. The revision object's
  presence identifies CAS support; an absent namespace revision means zero. An
  absent/malformed revision object, invalid revision, ambiguous duplicate profile
  or unsafe metadata disables editing, rather than falling back to blind writes.
- [`profiles.configure`](https://github.com/NousResearch/hermes-agent/blob/0e427d788d253630d38a3a51cd76849e73cd6925/tui_gateway/methods_profiles.py#L384-L408)
  has independent sections. Top-level `description` is the **operational role**;
  it is never sent. `ui_meta` merges **namespace keys**, not fields within each
  namespace. Clanker preserves the entire current `hermes-bots` object (including
  hidden/grouping/appearance/unknown fields), modifies only title/description,
  and sends only that namespace. Other namespaces and profile YAML fields remain
  Hermes-owned and are preserved by Hermes' merge.
- [`_configure_ui_meta`](https://github.com/NousResearch/hermes-agent/blob/0e427d788d253630d38a3a51cd76849e73cd6925/tui_gateway/methods_profiles.py#L594-L645)
  requires matching `ui_meta_expected_revisions`; rejection reports
  `applied.ui_meta:false` and `ui_meta_conflicts`. Successful writes report
  `applied.ui_meta:true` and the incremented revision. Clanker verifies those
  fields, not merely a successful RPC response. There is no automatic write retry.
- [`profiles.get_asset`](https://github.com/NousResearch/hermes-agent/blob/0e427d788d253630d38a3a51cd76849e73cd6925/tui_gateway/methods_profiles.py#L449-L464)
  returns `{found:false}` or `{found:true,mime,size,data}` with a base64 data URL.
  Clanker passes exactly `{name:<main-resolved slug>,asset:'avatar'}`. Unknown-method
  responses become unsupported, separate from missing art or malformed/error data.

Blank cosmetic values restore the **existing** roster fallback: native profile
`display_name`, then prettified canonical slug; description falls back to the
native operational role text for display only. The editor never initializes its
Bot tagline from that operational fallback and never edits the role.

## Main-owned safety and lifecycle

Focused modules: `src/main/assistants/assistantPresentation.ts` and
`assistantAvatar.ts`. Three narrow IPC operations expose projected cosmetics,
normalized avatars and cosmetic updates; there is no generic RPC, URL, asset-name
or raw-metadata channel. The renderer sends an opaque Assistant ID and bounded
text plus a main-generated edit snapshot token. That token is not a backend
credential and cannot select a profile or connection.

- Entry resolution requires the owning service's current, connected, valid named
  **local** profile. Unknown/default/remote-looking IDs are refused. Edit snapshots
  bind the exact RPC connection, profile and a hash of its namespace + revision;
  disconnect/disable/reconnect or changed metadata invalidates them.
- Saves first re-read the native roster. A changed baseline, including unknown
  fields or same-value revision increments, is a conflict, not a silent rebase.
  Native CAS then protects the interval after that read. Every confirmed/rejected/
  unconfirmed dispatch re-reads authoritative values when the connection permits.
  A late response from a lost connection never reports success. Saves are limited
  to one per profile/four globally; each native RPC uses the existing ten-second
  deadline. Timeout/connection loss may leave an unknown native write outcome;
  the UI says so and does not blindly retry.
- Only safe bounded title/tagline strings reach the editor (80/200 characters).
  Control characters and extra renderer write fields are rejected. Token/URL/home
  path/actual native profile path/credential-like display text is redacted. Long/redacted/non-text cosmetics
  and excessively large namespaces remain read-only to avoid saving a truncated
  or sanitized substitute over native values. Unknown metadata stays private in
  main. The namespace budget conservatively accounts for Python's escaped JSON
  and spacing beneath Hermes' 64 KiB cap.
- Roster read epochs reject out-of-order results. Cosmetic drafts retain their
  original baseline when another roster snapshot arrives; conflict responses
  explicitly reload the winner. **Reload values**, **Refresh details** and
  **Refresh profiles** provide explicit authoritative refresh paths.
- Avatar checks cover exact envelope/MIME/data-URL agreement, canonical base64,
  decoded length ≤ **2,000,000 bytes** (Hermes' native write limit), PNG/JPEG
  signatures, pre-decode dimensions ≤2048×2048 and matching actual decoded
  dimensions. Electron decodes and re-encodes a ≤128px PNG thumbnail ≤128 KiB,
  stripping original metadata. Original asset bytes never reach the renderer.
  SVG, GIF, external URLs and unverified formats are not rendered.
- Native Electron 41.10.7 checks passed PNG/JPEG decoding but rejected WebP.
  WebP is explicitly **unsupported**, with fallback and Settings explanation;
  no new runtime codec dependency or speculative decoder was added.
- Avatar requests coalesce per profile/generation, with four active slots, at
  most 64 queued/in-flight requests and sixteen cached thumbnails for sixty
  seconds. Explicit roster refresh invalidates them. Late epoch/connection results
  cannot populate the cache or UI. Thumbnail data is not added to snapshots,
  persistent preferences or the renderer's historical `knownAssistants` catalog.

Remaining upstream risks: `get_asset` itself reads a whole file without its own
read-side size cap. Clanker rejects excessive data under the existing 4 MiB RPC
frame policy and does not forward it, but cannot bound Hermes' internal file-read
allocation. An oversized frame can disconnect the control connection. CAS uses
an upstream process-local lock, not a cross-process filesystem transaction;
independent backend processes or writers bypassing native revisions are outside
that guarantee. These are not solved with a Clanker filesystem/config adapter.

## Avatar replacement: evaluated and deferred

[`profiles.set_asset`](https://github.com/NousResearch/hermes-agent/blob/0e427d788d253630d38a3a51cd76849e73cd6925/tui_gateway/methods_profiles.py#L411-L446)
accepts sniffed PNG/JPEG/WebP ≤2,000,000 bytes. However, it has no expected asset
revision/hash, unlinks existing avatar files **before** writing, and uses a shared
`avatar.<ext>.tmp` filename without a mutation lock. The final rename is atomic,
but preservation of the old avatar on write failure and concurrency safety are
not guaranteed. No upload/clear control or `set_asset` IPC was added. Recommend
upstream replacement staging before removal, unique temporaries and a supported
asset concurrency contract before adding this narrow control.

## Verification

Focused automated coverage adds real PNG/JPEG/WebP format fixtures plus main and
renderer regressions for missing/malformed/excessive avatars, decode/dimension
failures, unsupported APIs, cache/queue bounds, timeout/recovery, stale selections/
epochs, native fallback, namespace preservation (including native hiding), CAS
conflicts, unknown write outcomes, disconnect/reconnect and stable identity. The
existing local availability/roster/details/IPC tests remain in the validation run.

`npm run build` and an isolated Electron native codec check passed: PNG/JPEG →
128×64 normalized PNG; WebP → explicit unsupported fallback. No Hermes was started
for that codec check.

`scripts/assistant-details-smoke.cjs` was extended and **passed** with built
Electron + the real installed Hermes backend source, isolated temporary homes,
fixture avatars/profiles and no prompts or job execution. It verified native
cosmetic saves, unchanged operational role/unknown namespace/hidden/group fields,
concurrent external fixture-file edits rejected by the editor baseline, native
missing/normalized avatar reads, stable IDs, and the existing details/visibility/
zero-workspace/focus-return checks. The focus-return assertion now waits for the
normal asynchronous focus restoration instead of testing it immediately.
A physical appearance screenshot was reviewed at
`/tmp/clanker-182-assistant-appearance.png` (ephemeral, not committed).

This native smoke used the existing Python 3.11 venv via a private temporary
`HERMES_SMOKE_BIN_DIR` adapter to `hermes_cli.web_server.start_server`, as in the
Phase #157 evidence. It did not run the installed CLI dependency bootstrap,
install/repair dependencies, edit user profiles, adopt a user backend or test a
paid native chat turn. The owned fixture backend and fixture homes were cleaned
up. This proves the native backend/IPC/UI write path, **not** normal CLI-launcher
health. Windows was not live-tested. No SSH operation was performed.

Final gate: **`npm run validate` passed**, including branding, lint, typecheck,
Fallow full/production identity checks, security, build and **407 suites / 7,932
tests**. The security check used only the existing documented dev-only
`GHSA-ch52-4w7c-c8xp` exception; no other high/critical findings. Non-failing
bundle-size and Node experimental-localStorage notices remain. The nine focused
main/renderer suites also passed (411 tests).

## Branch hygiene / PR separation

`b34527094d6117632c2ef9409f56841080877c13` is an unrelated screenshot workstream:
`scripts/screenshots/capture.cjs`, gallery documentation and 2026-10-14 PNG/MP4/
manifest assets (76 files, 488 insertions, four deletions). It sits directly above
`a39bf84` and below Phase 1 `da79a75`; `git merge-base --is-ancestor b345270 origin/main`
returned false at review time. Its changes are untouched and it remains in this
branch's ancestry. A direct PR currently includes them.

Cleanest separation, **only with approval**: retain this branch untouched, land
or separately review the screenshot workstream, then create an approved clean-base
PR branch from the desired main and cherry-pick **only** the Phase 1 and Phase 2
Hermes commits. This preserves every original commit and avoids a reset/rebase/
force push. No additional branch, history rewrite or PR was made for this phase.
