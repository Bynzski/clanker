import * as v8 from 'node:v8';
import * as vm from 'node:vm';

/** `WeakRef` exists at runtime (Node 22) but not in the ES2020 lib the tests are typed against. */
export interface WeakHandle { deref(): object | undefined }
export function weakHandle(target: object): WeakHandle {
  const Ctor = (globalThis as unknown as { WeakRef: new (value: object) => WeakHandle }).WeakRef;
  return new Ctor(target);
}

/** Forces collection (enables V8's gc() on demand, so no `--expose-gc` runner flag is needed). */
export async function collectGarbage(): Promise<void> {
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc') as () => void;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    gc();
  }
}
