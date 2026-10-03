import { useCallback, useEffect, useMemo, useState } from 'react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogClose, DialogDescription } from '../ui/Dialog';
import {
  KEYBINDING_COMMANDS,
  findConflicts,
  formatKeystroke,
  getEffectiveBinding,
  getKeybindingCommand,
  isOverridden,
  isSafeBinding,
  keystrokeFromDomEvent,
  keystrokesEqual,
  resetBinding,
  setBinding,
  type KeybindingCategory,
  type KeybindingCommandId,
  type Keystroke,
} from '../../../shared/keybindings';
import { KEYBINDING_PLATFORM, useKeybindingStore } from '../../store/keybindingStore';
import './KeyboardShortcutsDialog.css';

interface KeyboardShortcutsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Compose focus events for a feature-level Popover → Dialog handoff. */
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
}

interface PendingConflict {
  id: KeybindingCommandId;
  keystroke: Keystroke;
  conflicts: KeybindingCommandId[];
}

const CATEGORY_ORDER: KeybindingCategory[] = ['Application', 'Layout', 'View', 'Editor', 'Zoom', 'Browser'];

function bindingLabel(keystroke: Keystroke | null): string {
  return keystroke ? formatKeystroke(keystroke, KEYBINDING_PLATFORM) : 'Unbound';
}

/** Dialog body; Radix unmounts it on close, so search/capture/conflict state resets without effects. */
function KeyboardShortcutsContent() {
  const overrides = useKeybindingStore((state) => state.overrides);
  const setOverrides = useKeybindingStore((state) => state.setOverrides);
  const setCapturing = useKeybindingStore((state) => state.setCapturing);
  const [query, setQuery] = useState('');
  const [capturingId, setCapturingId] = useState<KeybindingCommandId | null>(null);
  const [pending, setPending] = useState<PendingConflict | null>(null);
  const [error, setError] = useState('');

  const stopCapture = useCallback(() => setCapturingId(null), []);

  const persist = useCallback(async (next: typeof overrides) => {
    const result = await setOverrides(next);
    if (result.success) setError('');
    else setError(result.error);
    return result.success;
  }, [setOverrides]);

  const applyKeystroke = useCallback(async (id: KeybindingCommandId, keystroke: Keystroke | null) => {
    if (keystroke) {
      const current = getEffectiveBinding(id, overrides, KEYBINDING_PLATFORM);
      if (current && keystrokesEqual(current, keystroke)) return;
      const conflicts = findConflicts(id, keystroke, overrides, KEYBINDING_PLATFORM);
      if (conflicts.length > 0) {
        setPending({ id, keystroke, conflicts });
        return;
      }
    }
    await persist(setBinding(overrides, id, keystroke, KEYBINDING_PLATFORM));
  }, [overrides, persist]);

  // Recording: the pressed shortcut must never execute, so it is consumed in the
  // window capture phase before the app dispatcher, xterm, or Radix see it.
  useEffect(() => {
    if (capturingId == null) return undefined;
    setCapturing(true);
    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
      if (plain && event.key === 'Escape') {
        stopCapture();
        return;
      }
      if (plain && (event.key === 'Delete' || event.key === 'Backspace')) {
        stopCapture();
        void applyKeystroke(capturingId, null);
        return;
      }
      const keystroke = keystrokeFromDomEvent(event, KEYBINDING_PLATFORM);
      if (!keystroke) return; // modifier-only press: keep waiting
      if (!isSafeBinding(keystroke)) {
        setError('Shortcuts need Ctrl/Cmd or Alt (Shift alone is not enough). Press another shortcut.');
        return; // keep capturing
      }
      setError('');
      stopCapture();
      void applyKeystroke(capturingId, keystroke);
    };
    const swallow = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', swallow, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', swallow, true);
      setCapturing(false);
    };
  }, [applyKeystroke, capturingId, setCapturing, stopCapture]);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return CATEGORY_ORDER.map((category) => ({
      category,
      commands: KEYBINDING_COMMANDS.filter((command) => {
        if (command.category !== category) return false;
        if (!needle) return true;
        const binding = bindingLabel(getEffectiveBinding(command.id, overrides, KEYBINDING_PLATFORM));
        return `${command.label} ${command.category} ${binding}`.toLowerCase().includes(needle);
      }),
    })).filter((group) => group.commands.length > 0);
  }, [overrides, query]);

  const hasOverrides = Object.keys(overrides).length > 0;
  const pendingCommand = pending ? getKeybindingCommand(pending.id) : null;

  return (
    <>
        <div className="keyboard-shortcuts-header clanker-dialog-header">
          <DialogTitle className="clanker-dialog-title">Keyboard Shortcuts</DialogTitle>
          <DialogClose asChild>
            <IconButton variant="ghost" className="clanker-dialog-close" aria-label="Close Keyboard Shortcuts" title="Close"><X size={14} /></IconButton>
          </DialogClose>
        </div>
        <DialogDescription className="keyboard-shortcuts-description">
          Terminal keys not listed here always go to the shell. Browser shortcuts apply while the browser has focus.
        </DialogDescription>

        <div className="keyboard-shortcuts-toolbar">
          <Input
            type="search"
            aria-label="Search shortcuts"
            placeholder="Search shortcuts…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button onClick={() => void persist({})} disabled={!hasOverrides || capturingId != null}>
            Reset All
          </Button>
        </div>

        {error && <div className="keyboard-shortcuts-error" role="alert">{error}</div>}

        {pending && pendingCommand && (
          <div className="keyboard-shortcuts-conflict" role="alert">
            <span>
              {formatKeystroke(pending.keystroke, KEYBINDING_PLATFORM)} is already used by{' '}
              {pending.conflicts.map((id) => getKeybindingCommand(id).label).join(', ')}.
              Replace it and assign it to {pendingCommand.label}?
            </span>
            <div className="keyboard-shortcuts-conflict-actions">
              <Button onClick={() => setPending(null)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={() => {
                  const { id, keystroke, conflicts } = pending;
                  setPending(null);
                  void persist(setBinding(overrides, id, keystroke, KEYBINDING_PLATFORM, conflicts));
                }}
              >
                Replace
              </Button>
            </div>
          </div>
        )}

        <div className="keyboard-shortcuts-body">
          {groups.length === 0 && <p className="keyboard-shortcuts-empty">No matching shortcuts.</p>}
          {groups.map((group) => (
            <section key={group.category} aria-label={group.category}>
              <h3 className="keyboard-shortcuts-category">{group.category}</h3>
              <ul className="keyboard-shortcuts-list">
                {group.commands.map((command) => {
                  const binding = getEffectiveBinding(command.id, overrides, KEYBINDING_PLATFORM);
                  const changed = isOverridden(command.id, overrides);
                  const capturing = capturingId === command.id;
                  return (
                    <li key={command.id} className="keyboard-shortcuts-row" data-changed={changed || undefined}>
                      <span className="keyboard-shortcuts-label">
                        {command.label}
                        {changed && <span className="keyboard-shortcuts-changed"> (changed)</span>}
                      </span>
                      <kbd className="keyboard-shortcuts-binding" data-unbound={binding ? undefined : true}>
                        {capturing ? 'Press desired shortcut…' : bindingLabel(binding)}
                      </kbd>
                      {capturing ? (
                        <Button onClick={stopCapture} aria-label={`Cancel editing ${command.label}`}>Cancel</Button>
                      ) : (
                        <Button
                          onClick={() => { setPending(null); setCapturingId(command.id); }}
                          disabled={capturingId != null}
                          aria-label={`Edit ${command.label} shortcut`}
                        >
                          Edit
                        </Button>
                      )}
                      <Button
                        onClick={() => void persist(resetBinding(overrides, command.id))}
                        disabled={!changed || capturingId != null}
                        aria-label={`Reset ${command.label} shortcut`}
                      >
                        Reset
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
        {capturingId != null && (
          <p className="keyboard-shortcuts-hint" role="status">Esc cancels · Delete clears the shortcut</p>
        )}
    </>
  );
}

export default function KeyboardShortcutsDialog({ isOpen, onClose, onOpenAutoFocus, onCloseAutoFocus }: KeyboardShortcutsDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="keyboard-shortcuts" overlayClassName="keyboard-shortcuts-overlay"
        onOpenAutoFocus={onOpenAutoFocus} onCloseAutoFocus={onCloseAutoFocus}>
        <KeyboardShortcutsContent />
      </DialogContent>
    </Dialog>
  );
}
