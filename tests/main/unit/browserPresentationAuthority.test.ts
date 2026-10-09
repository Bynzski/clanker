import { describe, expect, it } from 'vitest';
import { BrowserPresentationAuthority, validBrowserPresentation } from '../../../src/main/browserPresentationAuthority';

describe('Browser presentation authority', () => {
  it('fences old page/workspace activations and exact-tab geometry through one monotonic viewport lease', () => {
    const authority = new BrowserPresentationAuthority();
    const a = { paneId: 'a', epoch: 1 };
    const b = { paneId: 'b', epoch: 2 };
    expect(authority.claim('workspace', 'a1', a)).toBe(true);
    expect(authority.claim('workspace', 'b1', b)).toBe(true);
    expect(authority.claim('workspace', 'a1', a)).toBe(false);
    expect(authority.matches('workspace', 'a1', b)).toBe(false);
    expect(authority.matches('workspace', 'b1', a)).toBe(false);
    expect(authority.matches('other', 'b1', b)).toBe(false);
    expect(authority.canShow('workspace', 'a1')).toBe(false);
    expect(authority.canShow('workspace', 'b1')).toBe(true);
    expect(authority.allowsLegacyActivation('other')).toBe(false);
    expect(authority.hide('workspace', a)).toBe(false);
    expect(authority.matches('workspace', 'b1', b)).toBe(true);
    expect(authority.claim('other', 'c1', { paneId: 'c', epoch: 3 })).toBe(true);
    expect(authority.claim('workspace', 'b1', b)).toBe(false);
  });
  it('does not reactivate a hidden/closed presentation with a reused lease', () => {
    const authority = new BrowserPresentationAuthority();
    const lease = { paneId: 'pane', epoch: 10 };
    expect(authority.claim('workspace', 'tab', lease)).toBe(true);
    expect(authority.claim('workspace', 'tab', lease)).toBe(true);
    expect(authority.hide('workspace', lease)).toBe(true);
    expect(authority.claim('workspace', 'tab', lease)).toBe(false);
    expect(authority.canShow('workspace', 'tab')).toBe(false);
    expect(authority.allowsLegacyActivation('workspace')).toBe(false);
    expect(authority.claim('workspace', 'tab', { ...lease, epoch: 11 })).toBe(true);
    authority.retireTab('workspace', 'tab');
    expect(authority.claim('workspace', 'tab', { ...lease, epoch: 11 })).toBe(false);
    authority.dispose('workspace');
    expect(authority.allowsLegacyActivation('workspace')).toBe(true);
    expect(authority.claim('workspace', 'tab', lease)).toBe(false);
  });
  it('rejects malformed pane ids and epochs without advancing authority', () => {
    const authority = new BrowserPresentationAuthority();
    for (const value of [null, {}, { paneId: '', epoch: 1 }, { paneId: 'x\n', epoch: 1 },
      { paneId: 'x'.repeat(161), epoch: 1 }, { paneId: 'x', epoch: Infinity },
      { paneId: 'x', epoch: 1.5 }, { paneId: 'x', epoch: 0 }, { paneId: 'x', epoch: Number.MAX_SAFE_INTEGER + 1 }]) {
      expect(validBrowserPresentation(value)).toBe(false);
      expect(authority.claim('workspace', 'tab', value)).toBe(false);
    }
    expect(authority.claim('workspace', 'tab', { paneId: 'pane', epoch: 1 })).toBe(true);
    authority.reset();
    expect(authority.claim('workspace', 'tab', { paneId: 'pane', epoch: 1 })).toBe(true);
  });
});
