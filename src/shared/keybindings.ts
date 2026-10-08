/**
 * Canonical Clanker keybinding model.
 *
 * Defines WHAT configurable commands and bindings mean. It owns no input: each
 * surface (renderer DOM, xterm, CodeMirror, the Electron browser view) keeps
 * its own input boundary and asks this module which command a keystroke is.
 *
 * Everything here is pure so renderer, main and tests share one implementation.
 */

export type KeybindingContext = 'app' | 'editor' | 'terminal' | 'browser';

export type KeybindingCategory = 'Application' | 'Layout' | 'View' | 'Editor' | 'Zoom' | 'Browser';

export type KeybindingPlatform = 'mac' | 'other';

/**
 * One normalized keystroke.
 *
 * `primary` is the semantic Ctrl/Cmd modifier (Cmd on macOS, Ctrl elsewhere).
 * `ctrl` is a literal Control key and only exists on macOS, where it is distinct
 * from the primary modifier (e.g. the conventional Ctrl+Tab); elsewhere Control
 * is always `primary`, so `ctrl` is false.
 * `code` is a layout-independent `KeyboardEvent.code` value.
 */
export interface Keystroke {
  code: string;
  primary: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export const KEYBINDING_COMMAND_IDS = [
  'workspace.pageNext',
  'workspace.pagePrevious',
  'workspace.page1',
  'workspace.page2',
  'workspace.page3',
  'workspace.page4',
  'workspace.page5',
  'workspace.page6',
  'workspace.page7',
  'workspace.page8',
  'workspace.page9',
  'app.openSettings',
  'layout.fitAll',
  'view.toggleExplorer',
  'editor.save',
  'zoom.in',
  'zoom.out',
  'zoom.reset',
  'browser.focusAddress',
  'browser.newTab',
  'browser.closeTab',
  'browser.refresh',
  'browser.nextTab',
  'browser.previousTab',
] as const;

export type KeybindingCommandId = (typeof KEYBINDING_COMMAND_IDS)[number];
export type WorkspacePageCommandId = Extract<KeybindingCommandId, `workspace.page${string}`>;
export function isWorkspacePageCommand(command: KeybindingCommandId): command is WorkspacePageCommandId {
  return command.startsWith('workspace.page');
}

export interface KeybindingCommand {
  id: KeybindingCommandId;
  label: string;
  category: KeybindingCategory;
  /** Surfaces where this command is valid. Surfaces still decide whether to consume it. */
  contexts: readonly KeybindingContext[];
  defaultBinding: Keystroke;
  /** Replacement default on macOS when the cross-platform default is not usable there. */
  macDefaultBinding?: Keystroke;
  /** Fixed extra keystrokes honoured only while the command keeps its default binding. */
  defaultAliases?: readonly Keystroke[];
}

const key = (code: string, mods: Partial<Omit<Keystroke, 'code'>> = {}): Keystroke => ({
  code,
  primary: false,
  ctrl: false,
  shift: false,
  alt: false,
  ...mods,
});

const ALL_CONTEXTS: readonly KeybindingContext[] = ['app', 'editor', 'terminal', 'browser'];

export const KEYBINDING_COMMANDS: readonly KeybindingCommand[] = [
  { id: 'workspace.pageNext', label: 'Next Workspace Page', category: 'Layout', contexts: ALL_CONTEXTS, defaultBinding: key('PageDown', { primary: true, alt: true }) },
  { id: 'workspace.pagePrevious', label: 'Previous Workspace Page', category: 'Layout', contexts: ALL_CONTEXTS, defaultBinding: key('PageUp', { primary: true, alt: true }) },
  ...([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((slot): KeybindingCommand => ({ id: `workspace.page${slot}`, label: `Workspace Page ${slot}`, category: 'Layout', contexts: ALL_CONTEXTS, defaultBinding: key(`Digit${slot}`, { primary: true, alt: true }) })),

  { id: 'app.openSettings', label: 'Open Settings', category: 'Application', contexts: ['app', 'editor'],
    defaultBinding: key('Comma', { primary: true }) },
  { id: 'layout.fitAll', label: 'Fit All Panes', category: 'Layout', contexts: ['app', 'editor', 'browser'],
    defaultBinding: key('KeyF', { primary: true, alt: true }) },
  { id: 'view.toggleExplorer', label: 'Toggle Explorer', category: 'View', contexts: ['app', 'editor'],
    defaultBinding: key('KeyB', { primary: true }) },
  { id: 'editor.save', label: 'Save File', category: 'Editor', contexts: ['editor'],
    defaultBinding: key('KeyS', { primary: true }) },
  { id: 'zoom.in', label: 'Zoom In', category: 'Zoom', contexts: ALL_CONTEXTS,
    defaultBinding: key('Equal', { primary: true }),
    // Ctrl/Cmd++ (Shift+=) has always zoomed in as well.
    defaultAliases: [key('Equal', { primary: true, shift: true }), key('NumpadAdd', { primary: true })] },
  { id: 'zoom.out', label: 'Zoom Out', category: 'Zoom', contexts: ALL_CONTEXTS,
    defaultBinding: key('Minus', { primary: true }),
    defaultAliases: [key('NumpadSubtract', { primary: true })] },
  { id: 'zoom.reset', label: 'Reset Zoom', category: 'Zoom', contexts: ALL_CONTEXTS,
    defaultBinding: key('Digit0', { primary: true }),
    defaultAliases: [key('Numpad0', { primary: true })] },
  { id: 'browser.focusAddress', label: 'Focus Address Bar', category: 'Browser', contexts: ['browser'],
    defaultBinding: key('KeyL', { primary: true }) },
  { id: 'browser.newTab', label: 'New Tab', category: 'Browser', contexts: ['browser'],
    defaultBinding: key('KeyT', { primary: true }) },
  { id: 'browser.closeTab', label: 'Close Tab', category: 'Browser', contexts: ['browser'],
    defaultBinding: key('KeyW', { primary: true }) },
  { id: 'browser.refresh', label: 'Refresh', category: 'Browser', contexts: ['browser'],
    defaultBinding: key('KeyR', { primary: true }) },
  { id: 'browser.nextTab', label: 'Next Tab', category: 'Browser', contexts: ['browser'],
    defaultBinding: key('Tab', { primary: true }), macDefaultBinding: key('Tab', { ctrl: true }) },
  { id: 'browser.previousTab', label: 'Previous Tab', category: 'Browser', contexts: ['browser'],
    defaultBinding: key('Tab', { primary: true, shift: true }), macDefaultBinding: key('Tab', { ctrl: true, shift: true }) },
];

const COMMANDS_BY_ID: ReadonlyMap<string, KeybindingCommand> = new Map(
  KEYBINDING_COMMANDS.map((command) => [command.id, command]),
);

export function isKeybindingCommandId(value: unknown): value is KeybindingCommandId {
  return typeof value === 'string' && COMMANDS_BY_ID.has(value);
}

export function getKeybindingCommand(id: KeybindingCommandId): KeybindingCommand {
  return COMMANDS_BY_ID.get(id) as KeybindingCommand;
}

/* ----------------------------------------------------------------------------
 * Keystroke normalization
 * -------------------------------------------------------------------------- */

/** Minimal shape shared by DOM/xterm KeyboardEvents. */
export interface DomKeyLike {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Minimal shape of Electron's `before-input-event` Input. */
export interface ElectronInputLike {
  code?: string;
  control: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

export function platformFromString(platform: string | undefined | null): KeybindingPlatform {
  return typeof platform === 'string' && /^(darwin|mac)/i.test(platform) ? 'mac' : 'other';
}

const MODIFIER_CODES = new Set([
  'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight',
  'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'FnLock',
]);

export function isModifierCode(code: string): boolean {
  return MODIFIER_CODES.has(code);
}

const CODE_PATTERN = /^[A-Za-z0-9]{1,24}$/;

function fromModifierState(
  code: string | undefined,
  ctrl: boolean,
  meta: boolean,
  shift: boolean,
  alt: boolean,
  platform: KeybindingPlatform,
): Keystroke | null {
  if (typeof code !== 'string' || !CODE_PATTERN.test(code) || isModifierCode(code)) return null;
  return {
    code,
    primary: platform === 'mac' ? meta === true : ctrl === true || meta === true,
    ctrl: platform === 'mac' ? ctrl === true : false,
    shift: shift === true,
    alt: alt === true,
  };
}

/** Normalize a DOM/xterm keyboard event. Returns null for modifier-only or code-less events. */
export function keystrokeFromDomEvent(event: DomKeyLike, platform: KeybindingPlatform): Keystroke | null {
  return fromModifierState(event.code, event.ctrlKey, event.metaKey, event.shiftKey, event.altKey, platform);
}

/** Normalize an Electron `before-input-event` input. */
export function keystrokeFromElectronInput(input: ElectronInputLike, platform: KeybindingPlatform): Keystroke | null {
  return fromModifierState(input.code, input.control, input.meta, input.shift, input.alt, platform);
}

/**
 * A configurable binding needs a real command modifier (Ctrl/Cmd or Alt);
 * Shift alone, or no modifier, would steal ordinary typing from editors,
 * terminals, pages and inputs.
 */
export function isSafeBinding(keystroke: Keystroke): boolean {
  return keystroke.primary || keystroke.ctrl || keystroke.alt;
}

export function keystrokesEqual(a: Keystroke, b: Keystroke): boolean {
  return a.code === b.code && a.primary === b.primary && a.ctrl === b.ctrl && a.shift === b.shift && a.alt === b.alt;
}

/* ----------------------------------------------------------------------------
 * Display
 * -------------------------------------------------------------------------- */

const CODE_LABELS: Record<string, string> = {
  Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'", Backquote: '`',
  BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Space: 'Space', Enter: 'Enter', Tab: 'Tab',
  Escape: 'Esc', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
};

function codeLabel(code: string): string {
  if (CODE_LABELS[code]) return CODE_LABELS[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return `Num ${code.slice(6)}`;
  return code;
}

export function formatKeystroke(keystroke: Keystroke, platform: KeybindingPlatform): string {
  const parts: string[] = [];
  if (keystroke.ctrl) parts.push('Ctrl');
  if (keystroke.primary) parts.push(platform === 'mac' ? 'Cmd' : 'Ctrl');
  if (keystroke.alt) parts.push(platform === 'mac' ? 'Option' : 'Alt');
  if (keystroke.shift) parts.push('Shift');
  parts.push(codeLabel(keystroke.code));
  return parts.join('+');
}

/* ----------------------------------------------------------------------------
 * Overrides and effective bindings
 * -------------------------------------------------------------------------- */

/**
 * Persisted deviations from the registry defaults only.
 * A command absent from the map uses its default; `null` means explicitly unbound.
 */
export type KeybindingOverrides = Partial<Record<KeybindingCommandId, Keystroke | null>>;

export function getDefaultBinding(command: KeybindingCommand, platform: KeybindingPlatform): Keystroke {
  return platform === 'mac' && command.macDefaultBinding ? command.macDefaultBinding : command.defaultBinding;
}

/** Effective binding: override if present (null = unbound), otherwise the platform default. */
export function getEffectiveBinding(
  id: KeybindingCommandId,
  overrides: KeybindingOverrides,
  platform: KeybindingPlatform,
): Keystroke | null {
  if (Object.prototype.hasOwnProperty.call(overrides, id)) {
    const override = overrides[id];
    if (override === null) return null;
    if (override) return override;
  }
  return getDefaultBinding(getKeybindingCommand(id), platform);
}

export function isOverridden(id: KeybindingCommandId, overrides: KeybindingOverrides): boolean {
  return Object.prototype.hasOwnProperty.call(overrides, id) && overrides[id] !== undefined;
}

function commandMatches(
  command: KeybindingCommand,
  keystroke: Keystroke,
  overrides: KeybindingOverrides,
  platform: KeybindingPlatform,
): boolean {
  const effective = getEffectiveBinding(command.id, overrides, platform);
  if (effective && keystrokesEqual(effective, keystroke)) return true;
  if (!isOverridden(command.id, overrides) && command.defaultAliases) {
    return command.defaultAliases.some((alias) => keystrokesEqual(alias, keystroke));
  }
  return false;
}

export function contextsOverlap(a: readonly KeybindingContext[], b: readonly KeybindingContext[]): boolean {
  return a.some((context) => b.includes(context));
}

/**
 * The command a keystroke means in one context, or null.
 * Effective configurations are conflict-free for overlapping contexts, so at most one matches.
 */
export function resolveCommand(
  keystroke: Keystroke,
  context: KeybindingContext,
  overrides: KeybindingOverrides,
  platform: KeybindingPlatform,
): KeybindingCommandId | null {
  const match = KEYBINDING_COMMANDS.find((command) =>
    command.contexts.includes(context) && commandMatches(command, keystroke, overrides, platform));
  return match?.id ?? null;
}

/** Other commands whose effective keystroke equals `keystroke` in an overlapping context. */
export function findConflicts(
  id: KeybindingCommandId,
  keystroke: Keystroke,
  overrides: KeybindingOverrides,
  platform: KeybindingPlatform,
): KeybindingCommandId[] {
  const subject = getKeybindingCommand(id);
  return KEYBINDING_COMMANDS
    .filter((command) => command.id !== id
      && contextsOverlap(command.contexts, subject.contexts)
      && commandMatches(command, keystroke, overrides, platform))
    .map((command) => command.id);
}

/**
 * Set a command's binding (null = unbind) and return the new overrides.
 * Conflicting commands are explicitly unbound, never merely un-overridden, so a
 * replaced command cannot silently fall back to a default that re-conflicts.
 * Overrides that equal the default are dropped so only deviations persist.
 */
export function setBinding(
  overrides: KeybindingOverrides,
  id: KeybindingCommandId,
  keystroke: Keystroke | null,
  platform: KeybindingPlatform,
  replaceConflicts: readonly KeybindingCommandId[] = [],
): KeybindingOverrides {
  const next: KeybindingOverrides = { ...overrides };
  const assign = (target: KeybindingCommandId, value: Keystroke | null) => {
    const defaultBinding = getDefaultBinding(getKeybindingCommand(target), platform);
    if (value && keystrokesEqual(value, defaultBinding)) delete next[target];
    else next[target] = value;
  };
  for (const conflict of replaceConflicts) assign(conflict, null);
  assign(id, keystroke);
  return next;
}

export function resetBinding(overrides: KeybindingOverrides, id: KeybindingCommandId): KeybindingOverrides {
  const next = { ...overrides };
  delete next[id];
  return next;
}

/* ----------------------------------------------------------------------------
 * Validation of untrusted persisted/IPC input
 * -------------------------------------------------------------------------- */

function sanitizeKeystroke(value: unknown): Keystroke | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const { code, primary, ctrl, shift, alt } = record;
  if (typeof code !== 'string' || !CODE_PATTERN.test(code) || isModifierCode(code)) return null;
  if (typeof primary !== 'boolean' || typeof ctrl !== 'boolean' || typeof shift !== 'boolean' || typeof alt !== 'boolean') {
    return null;
  }
  const keystroke = { code, primary, ctrl, shift, alt };
  return isSafeBinding(keystroke) ? keystroke : null;
}

/**
 * Rebuild overrides from untrusted input, keeping only known command IDs with a
 * well-formed keystroke or explicit null. Anything else is dropped (the command
 * then falls back to its default).
 */
export function sanitizeKeybindingOverrides(value: unknown): KeybindingOverrides {
  const result: KeybindingOverrides = {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return result;
  for (const id of KEYBINDING_COMMAND_IDS) {
    if (!Object.prototype.hasOwnProperty.call(value, id)) continue;
    const raw = (value as Record<string, unknown>)[id];
    if (raw === null) {
      result[id] = null;
      continue;
    }
    const keystroke = sanitizeKeystroke(raw);
    if (keystroke) result[id] = keystroke;
  }
  return result;
}

/** Every pair of commands whose effective keystrokes collide in overlapping contexts. */
export function findAllConflicts(
  overrides: KeybindingOverrides,
  platform: KeybindingPlatform,
): Array<[KeybindingCommandId, KeybindingCommandId]> {
  const pairs: Array<[KeybindingCommandId, KeybindingCommandId]> = [];
  for (const command of KEYBINDING_COMMANDS) {
    const effective = getEffectiveBinding(command.id, overrides, platform);
    if (!effective) continue;
    for (const other of findConflicts(command.id, effective, overrides, platform)) {
      if (command.id < other) pairs.push([command.id, other]);
    }
  }
  return pairs;
}

/** Browser commands whose state lives in the renderer; main signals them instead of running them. */
export type BrowserKeybindingCommandId =
  | 'browser.focusAddress'
  | 'browser.newTab'
  | 'browser.closeTab'
  | 'browser.nextTab'
  | 'browser.previousTab';

export interface BrowserKeybindingCommandPayload {
  workspaceId: string;
  tabId: string;
  command: BrowserKeybindingCommandId | WorkspacePageCommandId;
}
