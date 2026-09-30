# Dialog foundation

Import feature UI from `Dialog` or `AlertDialog` in this directory. The exported
Root/Trigger/Close (or Action/Cancel)/Title/Description parts retain Radix APIs,
including controlled and uncontrolled opening and `asChild` composition.
Content owns its DOM element (no `asChild`) and adds the portal, backdrop,
Clanker theme styling, focus restoration for
triggerless controlled dialogs, and one browser suppression lease. Supply a
Title and Description (or explicitly omit Dialog's `aria-describedby`).

Content's optional `workspaceId` overrides WorkspaceScopeProvider; otherwise
suppression follows the active workspace or the legacy no-workspace snapshot.
The lease lasts for the mounted content, including any forced mounting. Do not
forceMount hidden content unless it should continue suppressing the browser.
Counts remain owned exclusively by workspaceStore. Existing callers with their
own leases may coexist during incremental migration.

Dialog dismisses on Escape/outside pointer interaction. AlertDialog focuses
Cancel and requires an explicit decision by default. `onBackdropCancel` is an
opt-in compatibility policy for ConfirmCloseDialog's existing backdrop behavior.
Controlled feature callbacks remain responsible for updating open state.

Nested content portals append above earlier dialogs at the same layer (1000).
Radix owns focus scopes and topmost Escape/outside interaction handling. Legacy
surfaces still have independent keyboard listeners/layers; review those when
migrating them, rather than adding DOM-class exceptions here.

## Buttons and single selection

Use `Button` for actions (`primary`, `secondary`, or `danger`, currently size
`sm`). It retains native button props and React 19 refs, defaults to
`type="button"`, and supports a `className` extension. Use `IconButton` for
icon-only actions; it shares Button behavior and requires `aria-label` or
`aria-labelledby` rather than relying on a tooltip.

Use compositional `SegmentedControl` / `SegmentedControlItem` for a one-of-N
choice. Label the group with `aria-label` or `aria-labelledby`, give each item
a stable string `value`, and use `value` / `onValueChange` or `defaultValue`.
Radix RadioGroup owns roving focus, arrow-key selection, disabled behavior and
radio semantics; `data-state="checked"` is the selected styling hook. Native
buttons need no headless dependency. Clanker owns all primitive styling through
semantic theme tokens; product classes can extend layout and preserve existing
appearance. Complex interaction remains backed by headless primitives.

## Popover

Use `Popover`, `PopoverTrigger`, `PopoverClose`, and `PopoverContent` for rich
triggered surfaces. Content portals, owns its DOM element, and retains Radix
side/alignment/collision and focus-event props. Radix handles dismissal and focus
restoration; Clanker owns token-based appearance. Dialog and Popover content each
automatically acquire one browser suppression lease for their mounted lifetime,
using the same explicit/context/active workspace resolution. Nested portals share
layer 1000 and append above their parent; no feature-specific Escape listeners
are needed. When handing a Popover off to a Dialog, prevent Popover close-auto-focus
at the feature boundary and explicitly focus the new dialog's intended control.
Radix supplies runtime width/height variables for collision-aware sizing; these
are positioning data, separate from Clanker's semantic theme tokens.

Settings and Chat History are interactive panels: use Popover, not menu semantics.
Use Dialog for modal workflows such as VCS Credentials. For a handoff with no
parent lease, keep the outgoing Popover open until the Dialog's open-autofocus
callback (its content lease is already acquired), then close it and prevent its
close-autofocus. Restore focus to a deliberate surviving origin on Dialog close.
