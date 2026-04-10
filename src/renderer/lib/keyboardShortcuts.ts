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

  const key = event.key.toLowerCase();

  if (key === '0') {
    return 'reset';
  }

  if (key === '-' || key === '_') {
    return 'out';
  }

  if (key === '=' || key === '+') {
    return 'in';
  }

  return null;
}
