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
