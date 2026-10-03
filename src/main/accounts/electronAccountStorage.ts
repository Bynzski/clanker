import Store from 'electron-store';
import type { HarnessAccountStorage } from './accountStorage';

/** electron-store backed storage in its own file; deliberately not part of the renderer-writable settings map. */
export function createElectronAccountStorage(): HarnessAccountStorage {
  const store = new Store<{ registry?: unknown }>({ name: 'harness-accounts' });
  return {
    load: () => store.get('registry'),
    save: (state) => store.set('registry', state),
  };
}
