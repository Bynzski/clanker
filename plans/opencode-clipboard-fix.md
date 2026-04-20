# Plan: Fix OpenCode TUI Clipboard Handling in xterm.js Terminal

**Date:** 2026-04-17 (Initial) / 2026-04-18 (Final - Implementation Ready)
**Status:** ✅ Root Cause Confirmed - Ready to Implement

---

## Summary

**Issue:** Mouse-select-to-clipboard doesn't work in OpenCode harness
**Root Cause:** OpenCode sends OSC 52 clipboard sequences, but Clanker Grid lacks the addon to handle them
**Fix:** Install and load `@xterm/addon-clipboard`

---

## Confirmed Findings

### 1. Other Terminals Work Fine

Verified: bash, Codex, Claude CLI, and other harnesses have working mouse-select-to-clipboard. The issue is **OpenCode-specific**.

### 2. OpenCode Fires Clipboard Event on Selection

Based on user investigation:
1. User selects text in OpenCode
2. User releases mouse button
3. **OpenCode fires a clipboard event** (sends OSC 52 sequences through PTY)
4. Clanker Grid does not capture this event
5. System clipboard remains empty

### 3. xterm.js onSelectionChange Behavior is Correct

Code review of xterm.js `SelectionService.ts` confirms:
- `onSelectionChange` fires exactly once when selection completes (on mouseup)
- It does NOT fire during drag operations
- The event fires from xterm.js's internal selection service

### 4. Root Cause: Missing OSC 52 Handler

OpenCode sends **OSC 52** (Operating System Command 52) clipboard sequences:

```
\x1b]52;<selection>;<base64-data>\x07
```

Clanker Grid does NOT have `@xterm/addon-clipboard` installed, so:
- xterm.js cannot process OSC 52 clipboard sequences
- The clipboard data from OpenCode passes through unhandled
- Nothing gets written to the system clipboard

### 5. Why Other Terminals Work

Terminals that rely on xterm.js's built-in selection (bash, etc.) trigger `onSelectionChange`, which Clanker Grid's handler captures and writes to clipboard via IPC → Electron.

OpenCode handles selection internally and sends OSC 52 instead, bypassing xterm.js's selection service entirely.

---

## Solution: Install @xterm/addon-clipboard

### What the Addon Does

```typescript
// From addon source (ClipboardAddon.ts):
this._disposable = terminal.parser.registerOscHandler(52, data => this._setOrReportClipboard(data));
```

When terminal sends OSC 52:
1. Addon registers handler for OSC 52 sequences
2. Intercepts sequence: `\x1b]52;c;<base64-data>\x07`
3. Decodes base64 data
4. Writes to system clipboard via `navigator.clipboard.writeText()`

### How It Fixes OpenCode

```
User selects text in OpenCode
    ↓
OpenCode sends OSC 52 sequence
    ↓
PTY forwards to xterm.js
    ↓
ClipboardAddon intercepts the sequence
    ↓
Decodes base64, writes to system clipboard
    ↓
User can paste successfully
```

---

## Impact on Existing Code

### Current Clipboard Handlers (Will Remain)

| Handler | Trigger | Route |
|---------|---------|-------|
| `onSelectionChange` | Mouse select in xterm.js | Renderer → IPC → Main → Electron clipboard |
| Ctrl+C with selection | Ctrl+C pressed | Same IPC route |
| Ctrl+Shift+C | Key combo pressed | Same IPC route |

### New Handler (From Addon)

| Handler | Trigger | Route |
|---------|---------|-------|
| OSC 52 handler | Terminal sends clipboard sequence | Addon → Browser Clipboard API |

### Are Changes Needed to Existing Code?

**No.** The addon is purely additive:

1. **Existing handlers remain active** - They don't interfere with OSC 52 handling
2. **Different triggers** - `onSelectionChange` fires on DOM selection, OSC 52 fires on PTY data
3. **Both write to system clipboard** - Either works, different routes

### Potential: Double Write (Not Harmful)

If OpenCode triggers both OSC 52 (addon handles) AND somehow triggers `onSelectionChange`:
- Both handlers write the same content to clipboard
- Harmless (two identical writes)

### Cleanup Opportunity (Optional)

After testing confirms the addon works, you could optionally:
- Remove `onSelectionChange` handler (not needed for OSC 52 terminals)
- Keep `Ctrl+Shift+C` handler (still useful for keyboard copy)

But there's no harm in keeping existing handlers - they provide fallback behavior.

---

## Version Compatibility

| Package | Current Version | Notes |
|---------|-----------------|-------|
| `@xterm/xterm` | 6.0.0 | Already installed |
| `@xterm/addon-clipboard` | 0.2.0 (latest) | **Install this** - no peer deps |
| `@xterm/addon-clipboard` | 0.3.0-beta.197 | Requires xterm ^6.1.0-beta.197 - don't use |

**Safe choice:** `@xterm/addon-clipboard@0.2.0` (no peerDependencies listed, compatible with xterm 6.x)

---

## Implementation Steps

### Step 1: Install the addon

```bash
npm install @xterm/addon-clipboard@0.2.0
```

### Step 2: Load the addon in TerminalPane.tsx

Add import:
```typescript
import { ClipboardAddon } from '@xterm/addon-clipboard';
```

Add to xterm initialization (after fitAddon):
```typescript
const clipboardAddon = new ClipboardAddon();
xterm.loadAddon(clipboardAddon);
```

### Step 3: Test

1. Open OpenCode harness
2. Select text with mouse
3. Release mouse
4. Try to paste in another app
5. **Expected:** Pasted text matches selection

Also verify other terminals still work:
1. Open bash terminal
2. Select text with mouse
3. Paste
4. **Expected:** Still works (existing handlers + addon both functional)

---

## Files to Modify

| File | Change | Risk |
|------|--------|------|
| `package.json` | Add `"@xterm/addon-clipboard": "0.2.0"` | Low |
| `src/renderer/components/TerminalPane.tsx` | Load the addon | Low |

**No changes needed to:**
- `terminalIpc.ts` (IPC handler unchanged)
- `preload.ts` (bridge unchanged)
- Existing clipboard handlers (remain active)

---

## Testing Checklist

### OpenCode
- [ ] Select text with mouse → release → paste → works
- [ ] Ctrl+Shift+C with selection → paste → works
- [ ] Ctrl+C with selection → paste → works (if selection still in xterm.js)

### Bash Terminal (Baseline)
- [ ] Select text with mouse → release → paste → works (existing behavior)
- [ ] Ctrl+Shift+C → works

### Other Harnesses (Codex, Claude CLI)
- [ ] Select text with mouse → release → paste → works

---

## Alternative Approaches Considered

### 1. Manual OSC 52 Handler (Not Needed)
Could parse OSC 52 manually, but:
- The addon is the official solution
- Simpler and maintained by xterm.js team
- No reason to reinvent the wheel

### 2. OpenCode-Specific Configuration (Not Needed)
Could configure OpenCode to disable mouse mode, but:
- Would break OpenCode's own mouse interactions
- Not necessary when addon handles clipboard properly

### 3. Remove Existing Handlers (Optional Cleanup)
After testing confirms addon works:
- Could remove `onSelectionChange` for cleaner code
- Keep Ctrl+Shift+C handler for keyboard copy fallback
- **Not required** - existing handlers don't hurt

---

## Rollback Plan

If something goes wrong:
1. Remove `@xterm/addon-clipboard` from package.json
2. Remove the `ClipboardAddon` import and `loadAddon()` call
3. Revert to previous state (existing handlers remain)

---

## References

1. [@xterm/addon-clipboard on npm](https://www.npmjs.com/package/@xterm/addon-clipboard)
2. [xterm.js OSC 52 specification](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h3-Operating-System-Commands)
3. [xterm.js source: SelectionService.ts](node_modules/@xterm/xterm/src/browser/services/SelectionService.ts)
4. [Addon source: ClipboardAddon.ts](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-clipboard)

---

## Conclusion

**Root cause confirmed:** OpenCode sends OSC 52 clipboard sequences, but Clanker Grid lacks the addon to handle them.

**Fix is simple and low-risk:**
- Install `@xterm/addon-clipboard@0.2.0`
- Load it in TerminalPane.tsx
- No changes to existing handlers needed
- Test and verify

**Why this works:**
- Addon intercepts OSC 52 from OpenCode
- Decodes base64 clipboard data
- Writes to system clipboard via browser API
- Existing handlers remain for other copy scenarios