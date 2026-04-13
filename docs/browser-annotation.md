# Browser Annotation

Annotate elements in the embedded browser to create structured descriptions for coding agents.

## Overview

Browser Annotation lets you select any element on a web page, capture its location and attributes, add a note, and export everything as a structured Markdown payload ready to paste into an AI coding agent.

This bridges the gap between **seeing a UI issue** and **describing it precisely**:

```
URL: https://example.com/settings
Tag: BUTTON
Primary Selector: #save-settings
Element Role: primary action button
UI Region: Profile
Ancestor Context: form section
Bounds: x=812 y=64 w=92 h=36
Note: Make this the primary CTA, increase horizontal padding.
```

## Using Annotation Mode

### Entering Annotation Mode

1. Open the **Browser** panel
2. Click the **pointer icon** (MousePointer2) in the browser toolbar
3. The button turns highlighted to indicate active mode
4. The cursor changes to a crosshair

### Selecting an Element

1. **Hover** over any element to see a highlight overlay and element label
2. **Click** on an element to select it
3. A popup appears with:
   - Element tag name
   - Selector preview
   - Element dimensions
   - Note textarea

### Adding a Note

1. Type your annotation in the textarea
2. Click **Copy Annotation** to copy the full structured output to clipboard
3. Click **Cancel** to deselect without copying

### Exiting Annotation Mode

- Press **Escape** anywhere on the page
- Click the **pointer icon** again in the toolbar
- Navigate to a different page (annotation mode resets on page load)

## Captured Data

Each annotation captures:

| Field | Description |
|-------|-------------|
| **URL** | Current page URL |
| **Title** | Page title |
| **Tag** | HTML tag name (BUTTON, DIV, etc.) |
| **Primary Selector** | Best-effort CSS selector |
| **Fallback Selectors** | Alternative selectors for robustness |
| **Element Role** | Semantic role (button, link, form field, etc.) |
| **UI Region** | Nearest heading or label (e.g., "Profile", "Settings") |
| **Ancestor Context** | Position context (sidebar, form section, etc.) |
| **Nearby Text** | Sibling text that helps identify the element |
| **Bounds** | Position and dimensions (x, y, width, height) |
| **Attributes** | Key attributes (id, name, type, href, etc.) |
| **Accessible Name** | ARIA label or name |
| **Note** | Your custom note |
| **Timestamp** | When the annotation was captured |

## Selector Strategy

The annotation system uses a priority-based selector strategy:

1. **`data-testid`** / **`data-test`** / **`data-qa`** — Most stable for testing
2. **`id`** — Usually stable
3. **`role` + `aria-label`** — Semantic selectors
4. **Tag + nth-of-type** — Last resort fallback

Multiple fallback selectors are captured so you can adapt if the primary selector doesn't work in your context.

## Context Extraction

The annotation system analyzes the element's surroundings to provide richer context:

- **UI Region**: Nearest heading, aria-label, or title above the element
- **Ancestor Context**: Inferred position (left sidebar, form section, navigation, etc.)
- **Element Role In Context**: What the element means locally (primary action button, repository list entry, etc.)
- **Nearby Text**: Sibling text that helps identify the element's purpose

This is especially useful for complex pages like GitHub, where you might want to distinguish between "Save" buttons in different sections.

## Example Output

```markdown
## Page Annotation
- URL: https://github.com/settings/profile
- Title:Public profile · GitHub
- Captured At: 2026-04-13T15:04:00Z

### Selected Element
- Tag: BUTTON
- Primary Selector: `button[data-testid="public-profile-save"]`
- Fallback Selectors: `.btn-primary`, `.js-edit-profile`
- Element Role: primary action button
- UI Region: Public profile
- Element Role In Context: action button
- Nearby Text: `Cancel`
- Ancestor Context: form section
- Bounds: x=812 y=340 w=120 h=36
- Attributes: type="button", data-testid="public-profile-save"
- Accessible Name: Save changes

### Annotation
Make this button more prominent — it's the primary CTA for the profile form.
```

## Workflow with AI Agents

1. Browse to the page with the issue
2. Enable annotation mode
3. Click the element you're describing
4. Add your note
5. Copy the annotation
6. Paste into your AI coding agent (Codex, Claude, Pi, etc.)

The structured output helps the agent understand exactly which element you mean, its position, and your intended change.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Main Process                                                │
│                                                              │
│  AnnotationController                                        │
│  ├── enable(workspaceId) → inject runtime + arm             │
│  ├── disable() → cleanup runtime                            │
│  ├── capture() → return-value from page                     │
│  ├── reinitialize() → re-inject after navigation            │
│  └── formatAnnotationMarkdown() → clipboard export           │
│                                                              │
│  AnnotationIPC                                              │
│  ├── ANNOTATION_ENABLE                                      │
│  ├── ANNOTATION_DISABLE                                     │
│  ├── ANNOTATION_CAPTURE                                     │
│  ├── ANNOTATION_EXPORT                                      │
│  └── ANNOTATION_ESCAPE                                      │
│                                                              │
│  Escape Handler (before-input-event)                         │
│  └── Two-layer: main process + injected runtime              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Browser Content (WebContentsView)                           │
│                                                              │
│  Injected Runtime                                           │
│  ├── Crosshair cursor on enable                             │
│  ├── Hover highlight (position: fixed, z-index)             │
│  ├── Element capture (selector, bounds, context)             │
│  ├── In-page popup (note textarea, Copy/Cancel)              │
│  └── Annotation storage (__clankerAnnotationData__)         │
└─────────────────────────────────────────────────────────────┘
```

### Key Implementation Details

- **Injected runtime**: JavaScript injected via `webContents.executeJavaScript()`
- **No browser preload**: Communication uses return-value capture
- **In-page popup**: Renders in page DOM with proper z-index (2147483647)
- **Escape handling**: Two-layer detection (main process + injected runtime)
- **Navigation handling**: Runtime re-injected on subsequent navigations
- **Double-injection guard**: Runtime checks `window.__clankerAnnotation__`

## Known Limitations

| Limitation | Description |
|------------|-------------|
| **Cross-origin iframes** | Cannot inspect inside cross-origin iframes; only the iframe element itself can be annotated |
| **Shadow DOM** | Elements inside Shadow DOM fall back to the host element |
| **CSS modules** | Pages with generated class names may produce fragile selectors |
| **Virtualized lists** | Elements may unmount quickly; annotation captures immediately on click |
| **Strict CSP** | May block injected scripts in edge cases (rare) |
| **Zoom / DPR** | Bounds include devicePixelRatio; zoom affects coordinate accuracy |

## IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `ANNOTATION_ENABLE` | renderer → main | Enable annotation mode |
| `ANNOTATION_DISABLE` | renderer → main | Disable annotation mode |
| `ANNOTATION_CAPTURE` | renderer → main | Capture annotation from page |
| `ANNOTATION_GET_STATE` | renderer → main | Get annotation state |
| `ANNOTATION_EXPORT` | renderer → main | Export annotation to clipboard |
| `ANNOTATION_CHECK_ESCAPED` | renderer → main | Check if Escape was pressed |
| `ANNOTATION_ESCAPE` | main → renderer | Escape event notification |
| `ANNOTATION_TRIGGER_COPY` | renderer → main | Trigger capture + export pipeline |

## Future Enhancements

Potential additions for future versions:

- **Screenshots**: Element or viewport capture
- **Multi-select**: Annotate multiple elements at once
- **Persistent storage**: Save annotations per page/session
- **Direct agent handoff**: Send directly to active terminal/agent pane
- **Source mapping**: Map selected elements to source code
