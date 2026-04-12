export type ZoomShortcutAction = 'in' | 'out' | 'reset';

export function isSaveShortcut(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 's';
}

function hasPrimaryModifier(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

export function getZoomShortcutAction(event: KeyboardEvent): ZoomShortcutAction | null {
  if (!hasPrimaryModifier(event) || event.altKey) {
    return null;
  }

  const code = event.code.toLowerCase();

  if (code === 'digit0') {
    return 'reset';
  }

  if (code === 'minus') {
    return 'out';
  }

  if (code === 'equal') {
    return 'in';
  }

  return null;
}
