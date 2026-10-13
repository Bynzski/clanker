import { recordSwitchRefresh } from './workspaceSwitchMetrics';

// Session discovery only: no timers, cancellation fiction, cross-resource scheduling or data cache.
interface Flight<T> { forced: boolean; promise: Promise<T>; successor?: Promise<T> }
export class SessionDiscoveryFlights<T> {
  private readonly running = new Map<string, Flight<T>>();

  has(key: string): boolean { return this.running.has(key); }

  run(key: string, forced: boolean, acquire: () => Promise<T>, valid: () => boolean = () => true): Promise<T> {
    const current = this.running.get(key);
    if (current) {
      if (!forced || current.forced || current.successor) {
        recordSwitchRefresh('session-shared');
        return current.successor ?? current.promise;
      }
      recordSwitchRefresh('session-successor');
      // An explicit refresh cannot inherit a scan started before that demand. One fresh successor,
      // even if the preceding scan fails. All further callers share it; no unbounded request queue.
      const successor = current.promise.catch(() => undefined).then(() => {
        if (!valid()) throw new Error('Session discovery was invalidated');
        current.forced = true;
        return acquire();
      }).finally(() => { if (this.running.get(key) === current) this.running.delete(key); });
      current.successor = successor;
      return successor;
    }
    const flight: Flight<T> = { forced, promise: Promise.resolve().then(() => {
      if (!valid()) throw new Error('Session discovery was invalidated');
      return acquire();
    }).finally(() => {
      if (this.running.get(key) === flight && !flight.successor) this.running.delete(key);
    }) };
    this.running.set(key, flight);
    return flight.promise;
  }
}

const identities = new WeakMap<object, number>();
let nextIdentity = 0;
/** Main-only identity; never logged, persisted or accepted from IPC arguments. */
export function sessionDiscoveryObjectId(value: object): number {
  let id = identities.get(value);
  if (id === undefined) { id = ++nextIdentity; identities.set(value, id); }
  return id;
}
