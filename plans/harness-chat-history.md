# Plan: Chat History Panel for AI Harnesses

**Created:** 2026-04-17
**Status:** Draft — Validated & all slices green ✅

> **Validation summary:** Plan is structurally sound and follows repo patterns. Several factual
> corrections and gap fixes identified below (marked with ⚠️). No blocking issues found.
> See the § Appendix: Validation Report for details.

## Context

Clanker Grid needs a small chat icon button in the header that opens a dropdown showing conversation history for AI harness sessions. Users can invoke past conversations into new terminal sessions. The UI should be intentionally small — icon button with a dropdown list, with workspace-based filtering.

## Goals

- [ ] Add chat icon button to header (Header.tsx)
- [ ] Create conversation history service in main process (sessionHistory.ts)
- [ ] Wire IPC channels for fetching and invoking sessions
- [ ] Implement workspace-based filtering (match session cwd to workspace path)
- [ ] Create ChatHistoryDropdown component (small, minimal)
- [ ] Support all four harnesses: Codex, OpenCode, Claude Code, Pi

## Discovery: Harness Session Storage

All four harnesses confirmed via actual CLI inspection on the target system. No blockers remaining.

| Harness | Base Dir | Session Format | Discovery Method | Invocation |
|---------|----------|----------------|------------------|------------|
| **OpenCode** | `~/.local/share/opencode/` | SQLite backend, CLI exposed | `opencode session list --format json` → returns `{id, title, directory, projectId, created, updated}`. Filter by `directory` field directly — no file reads needed. ⚠️ **Model enrichment deferred** — `session list` output has no model field; DB access is out of scope for this pass. | `opencode --session <id>`; `--fork` to fork instead of continue |
| **Claude Code** | `~/.claude/` | One JSONL per session (UUID filename), plaintext 30-day cache | Scan `~/.claude/projects/` for dirs matching `-<workspace-path-with-/-replaced-by->`. Read each `*.jsonl` file's `user` message `cwd` to confirm match. No `session list` subcommand. | `claude --resume <session-id>`; `--fork-session` to fork |
| **Codex CLI** | `~/.codex/` | JSONL per session file under `sessions/YYYY/MM/DD/` | `session_index.jsonl` → `{id, thread_name, updated_at}`. No `cwd` in index. To filter by workspace, locate each session file by ID (glob/find), then read first line — parse as JSON and access `payload.cwd`. ⚠️ **Filenames are `rollout-{datetime}-{id}.jsonl`**, NOT `{id}.jsonl`. | `codex resume <session-id>`; `codex fork <session-id>` for forking |
| **Pi** | `~/.pi/agent/` | JSONL per session file in session dirs | Read `~/.pi/agent/sessions/` directory (session dirs like `--home-jay-dev-projects-clanker-grid--`). For each JSONL file, parse first line — type is `"session"` at top level. Access `.cwd`, `.id`, `.timestamp` directly (no wrapper key). Model info is in `model_change` messages — not in the first line. Filter by prefix match on `cwd`. | `pi --session <absolute-path-to-jsonl>` |

### Key structural notes

- **OpenCode:** Cleanest discovery — CLI returns `directory` field, no filesystem reads needed.
- **Codex:** `session_index.jsonl` lacks `cwd`, requires O(n) file reads to filter. ⚠️ **Index had 92 entries on target system vs 287 total session files.** Always iterate the index, NOT the filesystem, to avoid reading orphaned sessions. Session file first lines are ~7KB (embed `base_instructions`). ⚠️ **Must use `find`/glob by ID to locate files** — the index has no path info and filenames include a datetime prefix.
- **Pi:** `cwd` present in first line. Model info lives in `model_change` messages — scan session file for last `model_change` entry to get `modelId` + `provider`.
- **Claude Code:** Project dir encoding is **not lossless via naive replace-all**. Hyphenated names decode incorrectly. Correct approach: encode workspace path as prefix pattern and scan for directory match, then confirm with session file `cwd`. ⚠️ **First user entries are often `isMeta: true` with `<local-command-caveat>` boilerplate** — must filter for non-meta, non-command user messages for title extraction.

### Verified output examples

**OpenCode** `opencode session list --format json`:
```json
{
  "id": "ses_2775a028fffeFaIcSDnyPo4Jay",
  "title": "Image visibility issue",
  "updated": 1776114741852,
  "directory": "/home/jay/dev/projects/clanker-grid"
}
```

**Codex** session file first line (`session_meta` payload):
```json
{
  "timestamp": "2026-04-16T13:03:37.381Z",
  "type": "session_meta",
  "payload": {
    "id": "019d9661-a4d3-7e93-a413-229086109874",
    "cwd": "/home/jay/dev/projects/clanker-blog",
    "originator": "codex-tui",
    "model_provider": "openai"
  }
}
```
Access `.payload.cwd`, not `.cwd` directly. ⚠️ Full first line is ~7KB due to embedded `base_instructions`.

**Claude Code** session file:
```
{"type":"user","message":{"role":"user","content":"can you look at the agents.md..."},"cwd":"/home/jay/dev/projects/clanker-grid","timestamp":"2026-04-17T03:50:17.006Z",...}
```
`message.content` is a plain string — use it directly as title. Do NOT access `content[0].text`. ⚠️ **Many first user entries have `isMeta: true`** — skip those for title extraction.

**Pi** session file:
```json
{"type":"session","version":3,"id":"019d998e-221f-7114-b69c-b4d5c3fd546f","timestamp":"2026-04-17T03:48:42.143Z","cwd":"/home/jay/dev/projects/clanker-grid"}
{"type":"model_change","modelId":"MiniMax-M2.7","provider":"minimax"}
```
Access `.cwd` directly on first line. Model info is in `model_change` lines.

**Claude Code** CLI (verified via `claude --help`):
- `-r, --resume [value]` — Resume by session ID
- `--fork-session` — Fork instead of reusing original session
- `--session-id <uuid>` — Use a specific session ID

**OpenCode** `--fork` (verified via `opencode --help`):
- `--fork` — fork the session when continuing (use with `--continue` or `--session`)

**Codex** CLI (verified via `codex resume --help` / `codex fork --help`):
- `codex resume [SESSION_ID]` — Resume a previous session
- `codex fork [SESSION_ID]` — Fork a previous session

**Pi** CLI (verified via `pi --help`):
- `pi --session <path>` — Use specific session file (⚠️ takes a file PATH, not an ID)
- `pi --fork <path>` — Fork specific session file or partial UUID into a new session

## Slices

### Slice 1: Session Discovery Service (main process)

**Bounding:** Main process service that reads session data from all four harness storage locations. Returns normalized session list. Does NOT include UI.

**Dependencies:** None

**Steps:**

1. Create `src/shared/types/session.ts` — define `HarnessSession` interface and harness-specific raw types:
   ```typescript
   export interface HarnessSession {
     id: string;
     harness: HarnessId;
     title: string;
     cwd: string;
     timestamp: number;
     modelId?: string;      // Set when model is discoverable (Pi, sometimes Claude, rarely Codex). OpenCode returns undefined this pass.
     provider?: string;     // Set alongside modelId for harnesses that need provider context
     filePath?: string;     // Required for Pi — pi --session takes a file path, not an ID
   }
   ```
   This goes in `src/shared/types/` because it's used by both main (discovery) and renderer (IPC response, UI).

2. Create `src/main/sessionHistory.ts` — export `discoverSessions(workspacePath?: string): Promise<HarnessSession[]>` (⚠️ async, not sync — involves CLI spawns and file I/O)

3. Implement `discoverOpenCodeSessions(workspacePath?: string)`:
   - Spawn `opencode session list --format json` via `child_process.execFile` (⚠️ use `execFile` not `spawn` — match the `runCommandOutput` pattern in `harnessCatalog.ts`), parse JSON
   - Filter sessions where `directory` field is a prefix of `workspacePath`
   - ⚠️ **Model enrichment deferred.** The `session list` CLI output has no model field. Querying the OpenCode SQLite DB for model info is explicitly out of scope for this pass. OpenCode sessions are mapped with `modelId` and `provider` as `undefined`. A future pass may add DB-based model enrichment.
   - Map to `HarnessSession[]` — `id`, `title`, `cwd` = `directory`, `timestamp` = `updated` (ms), `modelId` = undefined, `provider` = undefined
   - Handle missing OpenCode: catch ENOENT on spawn, return `[]`, log at debug level

4. Implement `discoverCodexSessions(workspacePath?: string)`:
   - Read `~/.codex/session_index.jsonl` → parse each line as JSON, collect `{id, thread_name, updated_at}`
   - ⚠️ **Codex session filenames are `rollout-{datetime}-{id}.jsonl`** — NOT `{id}.jsonl`. The index has no path info.
   - **Locating session files:** Run a single `find ~/.codex/sessions/ -name "*.jsonl"` to build a `Map<id, absolutePath>`. Then iterate the index and look up each session's file path from the map. This is N× faster than N individual `find` calls.
   - Read each located file's first line as JSON: access `.payload.cwd` (data is wrapped in `session_meta` payload — NOT `.cwd` directly)
   - Filter by `.payload.cwd` prefix match against `workspacePath`
   - Map to `HarnessSession[]` — `id` = session id, `title` = `thread_name`, `cwd` = `.payload.cwd`, `timestamp` = `Date.parse(updated_at)`
   - ⚠️ **Index may be stale:** 92 entries in index vs 287 session files on target. Index entries may reference deleted files. Handle `ENOENT` gracefully per-session (skip, log debug).
   - ⚠️ **First-line size:** Codex `session_meta` embeds `base_instructions` (~7KB per file). With ~92 sessions ≈ ~650KB total I/O. Cache the `Map<sessionId, cwd>` mapping for subsequent calls (see caching note below).
   - **Caching strategy:** Build `Map<sessionId, {cwd, filePath}>` on first call. Cache with a TTL of 60s. Invalidate on dropdown close or explicit refresh. Follow the pattern in `src/main/modelCache.ts`.

5. Implement `discoverPiSessions(workspacePath?: string)`:
   - Read `~/.pi/agent/sessions/` directory tree; each subdir named like `--home-jay-dev-projects-clanker-grid--`
   - For each session directory: list `*.jsonl` files (filename format: `{timestamp}_{id}.jsonl`)
   - Parse first line as JSON — top-level type is `"session"` (NOT `"session_meta"`)
   - Access `.cwd`, `.id`, `.timestamp` directly (no wrapper key — not `.session.cwd`)
   - Filter by `.cwd` prefix match against `workspacePath`
   - **For model info:** scan session file lines for entries where `type === "model_change"`; use the last one's `modelId` + `provider` (e.g., `"MiniMax-M2.7"` + `"minimax"`). ⚠️ `model_change` entries also contain `id` (short) and `timestamp` fields. Model info is not in the first line. Pi always has model info — it's set on session start.
   - Map to `HarnessSession[]` — ⚠️ **MUST set `filePath` to the absolute `.jsonl` path** for later invocation
   - Handle missing harness: catch ENOENT, return `[]`, log at debug level

6. Implement `discoverClaudeSessions(workspacePath?: string)`:
   - **Correct algorithm — do NOT use naive replace-all.** Naive replace-all (`-` → `/`) on `-home-jay-dev-projects-clanker-grid` produces `/home/jay/dev/projects/clanker/grid` — WRONG (actual cwd is `/home/jay/dev/projects/clanker-grid`)
   - Encode the target workspace path: strip leading `/`, replace `/` with `-`, prepend `-` → e.g., `/home/jay/dev/projects/clanker-grid` → `-home-jay-dev-projects-clanker-grid`
   - Scan `~/.claude/projects/` for directories that start with this encoded prefix
   - For each matching project dir: list `*.jsonl` files (filename is session UUID)
   - **To confirm match and get cwd:** read session file lines, find first `user` entry, access its `.cwd` field — filter by prefix match
   - ⚠️ **To extract title:** find the first `user` entry where `isMeta` is falsy AND `content` does not start with `<command` or `<local-command`. Use `.message.content` directly (plain string). If all user messages are meta/command entries, synthesize title `"Claude session"`. Do NOT access `content[0].text`.
   - **To extract timestamp:** first non-meta `user` entry's `.timestamp` field. Fallback: file mtime.
   - **To handle empty/malformed files:** if no `user` entry found, use file mtime as fallback timestamp, synthesize title `"Claude session"`, log at debug level. Guard all nested field access with optional chaining (`message?.content`) since corrupted sessions may have missing fields.
   - **For model info:** scan session file for first `assistant` entry → access `.message.model` (e.g., `"claude-haiku-4-5-20251001"`). ⚠️ ~50% of sessions have assistant entries with model info. If not found, omit model.
   - ⚠️ **Session ID format:** The session UUID is both the filename (without `.jsonl`) and the `sessionId` field in each entry. This is what `claude --resume <id>` expects.
   - Map to `HarnessSession[]` — `modelId` = `.message.model` (full model name), `provider` = `"anthropic"` (Claude always uses Anthropic)

7. Add `buildSessionInvokeArgs(session: HarnessSession, fork?: boolean): InvokeConfig`:
   - ⚠️ **ALL harness invocations MUST go through the wrapper script** (`ensureHarnessWrapperScript()`). The wrapper adds `~/.local/bin` to PATH and provides fallback shell on harness exit. This is the existing pattern in `terminalIpc.ts`.
   - **OpenCode:** `{ spawnCmd: wrapperPath, spawnArgs: ['opencode', '--session', session.id, ...(fork ? ['--fork'] : [])] }`. ⚠️ Use the wrapper, not `opencode` directly. No model flag — OpenCode `modelId` is undefined this pass.
   - **Pi:** `{ spawnCmd: wrapperPath, spawnArgs: ['pi', '--session', session.filePath, ...(model ? ['--model', model] : [])] }` — ⚠️ `filePath` is the absolute path to the `.jsonl` file. Model format: `provider/modelId`.
   - **Codex:** `{ spawnCmd: wrapperPath, spawnArgs: ['codex', fork ? 'fork' : 'resume', session.id, ...(model ? ['-m', model] : [])] }` — use `codex fork` for forking, `codex resume` for resuming.
   - **Claude Code:** `{ spawnCmd: wrapperPath, spawnArgs: ['claude', '--resume', session.id, ...(fork ? ['--fork-session'] : []), ...(model ? ['--model', model] : [])] }`
   - **Model reconstruction:** `model` is reconstructed from `session.modelId` + `session.provider` using harness-specific format (see Model Availability Matrix above). If `session.modelId` is undefined, omit the model flag entirely — the harness will use its own default.

**Verification:** Unit tests mock CLI spawns and filesystem reads; verify correct field extraction and filtering per harness.

---

### Slice 2: IPC Channel Registration

**Bounding:** Register session discovery and invocation handlers; expose in preload.

**Dependencies:** Slice 1

**Steps:**

1. Add to `src/shared/ipcChannels.ts`:
   - `SESSION_DISCOVER` — `discoverSessions(workspacePath?: string): HarnessSession[]`
   - `SESSION_INVOKE` — `invokeSession(session: HarnessSession, fork?: boolean): { id: string; pid: number }`
   - ⚠️ **Channel naming:** The codebase uses flat kebab-case for most channels (`spawn-terminal`, `get-harness-options`). Some use colon namespacing (`credential:generate-ssh-key`, `vcs:get-context`). Use flat kebab-case (`session-discover`, `session-invoke`) for consistency with the majority pattern.
   - Add both to the `ALL_IPC_CHANNELS` array in the same file

2. Create `src/main/ipc/sessionIpc.ts` — register both handlers:
   - `SESSION_DISCOVER`: calls `discoverSessions(workspacePath)` from `sessionHistory.ts`
   - `SESSION_INVOKE`: calls `buildSessionInvokeArgs` then spawns a PTY (reusing the spawn pattern from `terminalIpc.ts`). ⚠️ **Returns `{ id, pid }`** so the renderer can call `addTerminal` — matching the existing `spawnTerminal` pattern.
   - ⚠️ **PTY spawn reuse:** The spawn logic in `terminalIpc.ts` (PTY creation, startup buffer, event handlers) should be extracted into a shared `spawnPtyProcess(spawnCmd, spawnArgs, cwd, env, terminals, mainWindow)` function. Both `terminalIpc.ts` and `sessionIpc.ts` call this shared function. Avoid duplicating the ~60 lines of PTY setup code.
   - Export `registerSessionIpc(deps)` following the existing `register*Ipc(deps)` pattern

3. Add to `src/main/preload.ts` — expose `discoverSessions` and `invokeSession`:
   - Import new channel constants
   - Add bindings in the appropriate section
   - ⚠️ `invokeSession` should accept a serializable `session` object and optional `fork` boolean

4. Add type declarations to `src/renderer/electron.d.ts`:
   - Add `discoverSessions(workspacePath: string): Promise<HarnessSession[]>` to `ElectronAPI`
   - Add `invokeSession(session: HarnessSession, fork?: boolean): Promise<{ id: string; pid: number }>` to `ElectronAPI`
   - Import `HarnessSession` from `../../shared/types/session`

5. Register in `src/main/main.ts`:
   - Import `registerSessionIpc` from `./ipc/sessionIpc`
   - Call `registerSessionIpc(deps)` in the `app.whenReady()` block
   - Pass deps: `{ getTerminals, getMainWindow, getSafeWorkspacePath, getHarnessOptions }` (same deps pattern as `registerTerminalIpc`)

6. Update `tests/main/integration/ipcRegistration.test.ts`:
   - Import and register `registerSessionIpc` alongside all other IPC modules
   - This ensures the `ALL_IPC_CHANNELS` smoke test passes

**Verification:** Integration test verifies all channels registered (existing pattern in codebase).

---

### Slice 3: Chat Icon Button and Dropdown UI

**Bounding:** Add icon button to Header.tsx and create minimal dropdown component showing session list.

**Dependencies:** Slice 2

**Steps:**

1. Add `MessageSquare` icon from lucide-react to Header.tsx imports

2. Add state: `showChatHistory: boolean`, `chatSessions: HarnessSession[]`, `isLoadingSessions: boolean`, `chatDropdownRef: RefObject<HTMLDivElement>`

3. Create `src/renderer/components/ChatHistoryDropdown.tsx` + `src/renderer/components/ChatHistoryDropdown.css` (⚠️ colocated CSS, matching the pattern used by Header, StatusBar, BrowserPanel, etc.):
   - Dropdown positioned below chat icon button
   - Groups sessions by harness (harness icon + name as group header)
   - Session row: title, harness icon, relative timestamp ("2 hours ago", "yesterday")
   - Pi model display: show `modelId` + `provider` from `model_change` when available; show harness name alone when `modelId` is null
   - Click session → calls `invokeSession` IPC → on success calls `addTerminal({ id, pid, workingDir })` in the store
   - Loading skeleton while sessions load
   - Empty state: "No sessions for this workspace"

4. Add chat icon button in `header-right` area (⚠️ **between fit-all-panes button and settings dropdown**). There is no "fastfetch toggle" in the header — fastfetch is inside the settings dropdown.

5. On dropdown open: call `discoverSessions(workspacePath)` filtered by current workspace

6. Close dropdown on outside click (reuse pattern from settings dropdown)

**Verification:** UI renders, sessions load from all harnesses, clicking session spawns terminal with session context.

---

### Slice 4: Session Invocation Integration with Terminal Spawn

**Bounding:** Connect session invocation to the terminal spawn flow.

**Dependencies:** Slice 3

**Steps:**

1. ⚠️ **Do NOT add `invokeSession` to `terminalIpc.ts`.** It goes in `sessionIpc.ts` (created in Slice 2). Extract the shared PTY spawn logic from `terminalIpc.ts` into a helper function used by both.

2. For **all harnesses**: always use `ensureHarnessWrapperScript()` for the spawn command. The wrapper adds `~/.local/bin` to PATH and provides fallback shell on harness exit. This is the existing pattern in `terminalIpc.ts` lines ~90-94.

3. For **OpenCode**: spawn via wrapper with args `['opencode', '--session', sessionId]` (+ `['--fork']` if forking)

4. For **Pi**: spawn via wrapper with args `['pi', '--session', sessionFilePath]` — ⚠️ `sessionFilePath` is the absolute path to the `.jsonl` file

5. For **Codex**: spawn via wrapper with args `['codex', fork ? 'fork' : 'resume', sessionId]`

6. For **Claude Code**: spawn via wrapper with args `['claude', '--resume', sessionId]` (+ `['--fork-session']` if forking)

7. Fallback: if harness is unavailable, return error with helpful message. Log at error level.

8. **Model passthrough:** Before constructing spawn args, check if `session.modelId` is set. If yes, reconstruct the model string in harness-specific format:
   - **Pi:** `provider/modelId` (e.g., `minimax/MiniMax-M2.7`) — matches Pi's `--model provider/id` syntax
   - **OpenCode:** N/A — `modelId` is always undefined this pass. No model flag emitted.
   - **Claude:** `modelId` as-is (e.g., `claude-haiku-4-5-20251001`) — Claude accepts both full names and aliases
   - **Codex:** `modelId` as-is (e.g., `gpt-5.1-codex-mini`) — Codex accepts `-m model`
   - If `session.modelId` is undefined, omit the model flag entirely. The harness uses its own default.

9. ⚠️ **No changes needed to `harnessLaunch.ts`.** The `buildHarnessSpawnArgs` function adds model + user flags to harness args. Session invocation replaces model/flags with session-specific args — this is a separate code path via `buildSessionInvokeArgs`. Keep the two code paths independent.

**Verification:** Each harness spawns terminal with correct harness + session args.

---

### Slice 5: Workspace Filtering and Edge Cases

**Bounding:** Validate workspace filtering across all harnesses and handle edge cases.

**Dependencies:** Slice 1 + Slice 2

**Steps:**

1. Normalize workspace path: strip trailing `/`, case-sensitive on Linux
2. **OpenCode:** prefix match `directory` field against normalized workspacePath
3. **Pi:** prefix match `.cwd` on first JSON line against normalized workspacePath. For model: scan lines for last `model_change` → `.modelId` + `.provider`
4. **Codex:** locate session file, read first line, parse JSON, access `.payload.cwd` → prefix match
5. **Claude Code:** encode workspacePath as `-<path-with-/-replaced-by->`, scan for matching directory prefix in `~/.claude/projects/`, confirm with session file `cwd`
6. Handle missing harness: catch ENOENT, log at debug, continue with other harnesses — never fail all discovery for one missing harness
7. Handle malformed session files: skip with warning at debug level, don't crash discovery for the whole harness

**Verification:** With active workspace at `/home/jay/dev/projects/clanker-grid`, dropdown shows only sessions with matching cwd for all four harnesses.

## Resolved Decisions

1. **✅ Session invocation spawns a NEW terminal.** Uses the same `spawnTerminal` + `addTerminal` flow as `+ New Terminal`. No targeting of existing terminals. The IPC returns `{ id, pid }` so the renderer can call `addTerminal` in the store.

2. **✅ Pi session file path storage.** `HarnessSession` interface has `filePath?: string`. Set for Pi sessions only (Pi `--session <path>` requires the absolute `.jsonl` path). Other harnesses use ID-based invocation.

3. **✅ Codex session file discovery.** Single `find ~/.codex/sessions/ -name "*.jsonl"` builds a `Map<id, absolutePath>`. Index entries look up paths from this map. Handles stale index entries (ENOENT → skip).

4. **✅ Claude title extraction.** Filter for first `user` entry where `isMeta` is falsy AND `content` does not start with `<command` or `<local-command`. Fallback: file mtime + title `"Claude session"`.

5. **✅ Async discovery with caching.** `discoverSessions` returns `Promise<HarnessSession[]>`. Results cached with 60s TTL. Cache invalidated on dropdown close. Follows `modelCache.ts` pattern.

6. **✅ PTY spawn code sharing.** Extract `spawnPtyProcess()` helper from `terminalIpc.ts` into a shared module (or export from `terminalIpc.ts`). Both `terminalIpc.ts` and `sessionIpc.ts` call this helper. No duplication.

7. **✅ Model passthrough on invoke.** When model info is available in the session data, pass `--model <model>` to the harness at spawn time. When not available, spawn without model flag (harness uses its default). See Model Availability Matrix below.

### Model Availability Matrix

Verified against live session data on the target system:

| Harness | Model Available? | Source Location | Format | Invoke Flag |
|---------|-----------------|-----------------|--------|-------------|
| **Pi** | ✅ Yes, always | Last `model_change` line in session file | `{ provider, modelId }` e.g. `minimax` / `MiniMax-M2.7` | `--model {provider}/{modelId}` (Pi accepts `provider/id` format) |
| **OpenCode** | ⏳ Deferred | `session list` CLI has no model field. SQLite DB has model info but DB access is out of scope. | N/A this pass | N/A this pass — no model flag |
| **Claude Code** | ⚠️ Sometimes | `assistant` message entries → `.message.model` | Full model name e.g. `"claude-haiku-4-5-20251001"` | `--model {model}` (Claude accepts aliases or full names) |
| **Codex** | ❌ Rarely | `session_meta.payload.model` (usually null) + `payload.model_provider` (always `"openai"`, not useful alone) | Model name or null | `-m {model}` (Codex accepts `-m` flag) |

**Implementation strategy:**
- **Pi:** Always pass model — scan session file for last `model_change`, reconstruct `provider/modelId` format.
- **OpenCode:** Model enrichment deferred to a future pass. No DB access this pass. OpenCode sessions are invoked without `--model`; the harness uses its configured default.
- **Claude:** Scan session file for first `assistant` entry's `.message.model`. If found, pass via `--model`. ~50% of sessions have model info; older sessions may not.
- **Codex:** Read `payload.model` from `session_meta`. If present, pass via `-m`. If null (common), omit model — Codex will use its configured default from `~/.codex/config.toml`.
- **Fallback for all:** If model extraction fails for any harness, spawn without `--model` flag. The harness uses its own default. Never block invocation because model info is missing.

## Blockers

- [x] All blockers resolved — all four harnesses verified on target system. Session discovery and invocation mechanisms confirmed.

## Speculation

**This plan does not include:**
- Session search/filter UI beyond workspace filtering
- Session content viewer
- Session deletion or management
- Multi-harness session merge
- Non-harness (plain shell) session history
- **OpenCode model/provider enrichment** — requires SQLite DB dependency; deferred to a future pass. OpenCode sessions will not include model info this pass.

## File Inventory

| File | Action | Purpose |
|------|--------|---------|
| `src/shared/types/session.ts` | Create | `HarnessSession` interface and harness-specific session types |
| `src/main/sessionHistory.ts` | Create | Main process session discovery + invocation service |
| `src/main/ipc/sessionIpc.ts` | Create | IPC handlers for session operations |
| `src/shared/ipcChannels.ts` | Modify | Add SESSION_DISCOVER, SESSION_INVOKE channels |
| `src/main/preload.ts` | Modify | Expose discoverSessions, invokeSession to renderer |
| `src/renderer/electron.d.ts` | Modify | Add type declarations for new IPC methods |
| `src/renderer/components/ChatHistoryDropdown.tsx` | Create | Session list dropdown component |
| `src/renderer/components/ChatHistoryDropdown.css` | Create | Styles for dropdown |
| `src/renderer/components/Header.tsx` | Modify | Add chat icon button and state |
| `src/main/main.ts` | Modify | Register sessionIpc in app.whenReady() |
| `src/main/ipc/terminalIpc.ts` | Modify | Extract shared PTY spawn helper |
| `tests/main/unit/sessionHistory.test.ts` | Create | Unit tests for session discovery service |
| `tests/main/integration/ipcRegistration.test.ts` | Modify | Register sessionIpc in smoke test |

⚠️ **Files removed from original inventory:**
- ~~`src/main/harnessLaunch.ts`~~ — No modification needed. Session args are a separate code path from model/flags args.

---

## Appendix: Validation Report

### Methodology
Every factual claim in the original plan was verified against the live codebase and harness installations on the target system. Files read: `ipcChannels.ts`, `preload.ts`, `harnessLaunch.ts`, `harnessCatalog.ts`, `terminalIpc.ts`, `Header.tsx`, `Header.css`, `main.ts`, `electron.d.ts`, `harnessIds.ts`, `harnessOptions.ts`, `ipcRegistration.test.ts`, plus live inspection of all four harness session stores.

### ✅ Confirmed Correct

1. **OpenCode:** `opencode session list --format json` returns `{id, title, directory, updated, created, projectId}`. Clean and reliable.
2. **Pi:** Session first line has `{type: "session", version: 3, id, timestamp, cwd}`. Model in `model_change` lines. Session dir naming confirmed. `pi --session <path>` takes file path.
3. **Claude Code:** Project dir encoding is `-home-jay-dev-projects-clanker-grid` (verified). Session files are JSONL with UUID filenames. Content is a plain string. `claude --resume <uuid>` and `--fork-session` flags confirmed.
4. **Codex:** `session_index.jsonl` format `{id, thread_name, updated_at}` confirmed. Session file first line is `session_meta` with `payload.cwd`.
5. **IPC patterns:** Plan correctly follows the repo's IPC registration pattern (constants in `ipcChannels.ts`, handler registration in `*Ipc.ts`, bridge in `preload.ts`, types in `electron.d.ts`).
6. **Harness IDs:** `codex`, `opencode`, `pi`, `claude` match `KNOWN_HARNESS_IDS` in `shared/harnessIds.ts`.
7. **Component CSS pattern:** Colocated `Component.css` files are the established pattern (28 CSS files, one per component directory).
8. **Outside-click pattern:** Header.tsx already has a `useEffect` for closing the settings dropdown on outside click — this can be reused for the chat dropdown.

### ⚠️ Corrections Applied

1. **Codex session file paths:** Original plan says `~/.codex/sessions/YYYY/MM/DD/{id}.jsonl`. Actual format is `rollout-{datetime}-{id}.jsonl`. Must use `find` or glob to locate files by ID.
2. **Codex first-line size:** Session_meta embeds `base_instructions` (~7KB per file). Not a showstopper but impacts caching strategy.
3. **Codex index vs filesystem:** Index had 92 entries; filesystem had 287 files. Must iterate index, not filesystem. Index entries may reference deleted files — handle ENOENT per-session.
4. **Codex model info:** `session_meta.payload.model` is usually null. `payload.model_provider` is always `"openai"` — not sufficient to reconstruct a model name. Codex model passthrough will usually be omitted.
5. **OpenCode wrapper:** Plan says spawn `opencode` directly. All harnesses should use the wrapper script for PATH setup and fallback shell. This is the established pattern in `terminalIpc.ts`.
6. **OpenCode model info deferred:** Not in `session list` CLI output. DB-based enrichment is out of scope for this pass. OpenCode sessions return `modelId` and `provider` as `undefined`. A future pass may add SQLite query for `message.data` → `.model.providerID` + `.model.modelID`.
7. **Pi session arg:** `pi --session <path>` requires the full `.jsonl` file path, not just a session ID. The `HarnessSession` type needs a `filePath` field.
8. **Claude title extraction:** First user entries are often `isMeta: true` with `<local-command-caveat>` boilerplate. Must filter for non-meta, non-command user messages.
9. **Claude model info:** Only in `assistant` message entries (`.message.model`). ~50% of sessions have assistant entries; older ones may not. Not in the `user` or `permission-mode` entries.
10. **Header placement:** No "fastfetch toggle" in the header bar — fastfetch is inside the settings dropdown. Chat button goes between fit-all-panes and settings.
11. **harnessLaunch.ts:** No modification needed — session args are independent of model/flags args. Keep `buildHarnessSpawnArgs` and `buildSessionInvokeArgs` as separate functions.

### ❌ Gaps Found

1. **Missing `electron.d.ts` update:** Plan did not mention updating `src/renderer/electron.d.ts` to add type declarations for `discoverSessions` and `invokeSession`. This is required — every other IPC method has a corresponding type declaration.

2. **Missing IPC registration test update:** `tests/main/integration/ipcRegistration.test.ts` must import and register `sessionIpc` to keep the `ALL_IPC_CHANNELS` smoke test passing.

3. **Missing `main.ts` registration:** Plan did not mention registering `sessionIpc` in `main.ts`'s `app.whenReady()` block. This is required for the handlers to actually be available.

4. **No caching strategy specified:** Session discovery involves CLI spawns (OpenCode) and filesystem reads (Codex, Pi, Claude). Without caching, dropdown open will be slow. The plan mentions caching as a performance afterthought in Slice 1 Step 3 but it should be a design requirement across all harnesses.

5. **Missing shared type file step:** Plan references `src/shared/types/session.ts` in the file inventory but the Slice 1 steps don't explicitly specify creating it. The `HarnessSession` interface should be defined here and imported by both main and renderer.

6. **Session invocation spawns terminal silently:** Plan doesn't address how the renderer learns about the new terminal ID. The current `spawnTerminal` IPC returns `{id, pid}` which the renderer uses to call `addTerminal`. Session invocation must follow the same pattern: IPC returns terminal info, renderer calls `addTerminal`.

7. **PTY spawn code duplication:** The `terminalIpc.ts` PTY spawn logic (~60 lines) would need to be duplicated in `sessionIpc.ts`. Instead, extract a shared helper function.

8. **`discoverSessions` should be async:** Original plan typed it as synchronous return. CLI spawns and file I/O require `Promise<HarnessSession[]>`.

9. **Codex forking uses `codex fork` not `codex resume --fork`:** The Codex CLI has a separate `fork` subcommand, not a `--fork` flag on `resume`. This is a different pattern from the other harnesses.

### Readiness Assessment

| Slice | Status | Notes |
|-------|--------|-------|
| 1: Session Discovery Service | 🟢 Ready | Codex glob+map approach specified; Claude `isMeta` filtering specified; `filePath` field for Pi; caching strategy defined; model extraction per-harness specified |
| 2: IPC Channel Registration | 🟢 Ready | Follows established patterns exactly; `electron.d.ts`, `main.ts`, and integration test updates specified |
| 3: Chat Icon Button + Dropdown UI | 🟢 Ready | Standard React + CSS component; placement between fit-all-panes and settings confirmed |
| 4: Session Invocation Integration | 🟢 Ready | Wrapper for ALL harnesses; Pi file path; Codex `fork` subcommand; PTY spawn helper extraction specified; model passthrough when available |
| 5: Workspace Filtering + Edge Cases | 🟢 Ready | All algorithms verified against live data |
