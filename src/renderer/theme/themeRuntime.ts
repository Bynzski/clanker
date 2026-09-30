import { useThemeStore } from './themeStore';
import { applyTerminalThemeToRegisteredTerminals } from './terminalTheme';

let stopSync: (() => void) | undefined;

/** One renderer-wide subscription, independent of mounted terminal panes. */
export function startTerminalThemeSync(): () => void {
  if (stopSync) return stopSync;

  applyTerminalThemeToRegisteredTerminals(useThemeStore.getState().theme);
  const unsubscribe = useThemeStore.subscribe((state, previous) => {
    if (state.theme !== previous.theme) {
      applyTerminalThemeToRegisteredTerminals(state.theme);
    }
  });
  const stop = () => {
    unsubscribe();
    if (stopSync === stop) stopSync = undefined;
  };
  stopSync = stop;
  return stop;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => stopSync?.());
}
