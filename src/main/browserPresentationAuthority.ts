import type { BrowserPresentation } from '../shared/types/browserPresentation';

export function validBrowserPaneId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\0\r\n]/.test(value);
}
export function validBrowserPresentation(value: unknown): value is BrowserPresentation {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<BrowserPresentation>;
  return validBrowserPaneId(candidate.paneId) && typeof candidate.epoch === 'number'
    && Number.isSafeInteger(candidate.epoch) && candidate.epoch > 0;
}

/** Single native viewport authority. Old leases cannot claim it, even after hide. */
export class BrowserPresentationAuthority {
  private highestEpoch = 0;
  private scopedOwners = new Set<string>();
  private current: { ownerId: string; tabId: string; lease: BrowserPresentation } | null = null;

  isScoped(ownerId: string): boolean { return this.scopedOwners.has(ownerId); }
  matches(ownerId: string, tabId: string | undefined, lease: unknown): boolean {
    return validBrowserPresentation(lease) && this.current?.ownerId === ownerId
      && this.current.lease.paneId === lease.paneId && this.current.lease.epoch === lease.epoch
      && (tabId === undefined || this.current.tabId === tabId);
  }
  allowsLegacyActivation(ownerId: string): boolean { return !this.current && !this.isScoped(ownerId); }
  canShow(ownerId: string, tabId: string): boolean {
    return this.current ? this.current.ownerId === ownerId && this.current.tabId === tabId : !this.isScoped(ownerId);
  }
  claim(ownerId: string, tabId: string, lease: unknown): boolean {
    if (!validBrowserPresentation(lease)) return false;
    if (lease.epoch <= this.highestEpoch) return this.matches(ownerId, tabId, lease);
    this.highestEpoch = lease.epoch;
    this.scopedOwners.add(ownerId);
    this.current = { ownerId, tabId, lease: { ...lease } };
    return true;
  }
  hide(ownerId: string, lease: unknown): boolean {
    if (!this.matches(ownerId, undefined, lease)) return false;
    this.current = null;
    return true;
  }
  retireTab(ownerId: string, tabId: string): void {
    if (this.current?.ownerId === ownerId && this.current.tabId === tabId) this.current = null;
  }
  dispose(ownerId: string): void {
    if (this.current?.ownerId === ownerId) this.current = null;
    this.scopedOwners.delete(ownerId);
  }
  reset(): void {
    this.current = null;
    this.scopedOwners.clear();
    this.highestEpoch = 0;
  }
}
