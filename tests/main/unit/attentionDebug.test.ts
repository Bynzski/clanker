import { describe, expect, it } from 'vitest';
import { shouldEnableAttentionDebug } from '../../../src/main/attentionDebug';

describe('agent attention diagnostic logging defaults', () => {
  it('enables attention logging for unpackaged development runs', () => {
    expect(shouldEnableAttentionDebug(undefined, false, '0.12.0')).toBe(true);
  });

  it('enables logging for packaged dev-version builds', () => {
    expect(shouldEnableAttentionDebug(undefined, true, '0.12.0-dev.5613a24')).toBe(true);
    expect(shouldEnableAttentionDebug(undefined, true, '0.12.0-dev')).toBe(true);
  });

  it('keeps production releases and unrelated prereleases quiet by default', () => {
    expect(shouldEnableAttentionDebug(undefined, true, '0.12.0')).toBe(false);
    expect(shouldEnableAttentionDebug(undefined, true, '0.12.0-rc.1')).toBe(false);
    expect(shouldEnableAttentionDebug(undefined, true, '0.12.0-development')).toBe(false);
  });

  it('honors explicit activation and deactivation on any build', () => {
    expect(shouldEnableAttentionDebug('1', true, '0.12.0')).toBe(true);
    expect(shouldEnableAttentionDebug('0', false, '0.12.0')).toBe(false);
    expect(shouldEnableAttentionDebug('0', true, '0.12.0-dev.1')).toBe(false);
    expect(shouldEnableAttentionDebug('', false, '0.12.0')).toBe(false);
  });
});
