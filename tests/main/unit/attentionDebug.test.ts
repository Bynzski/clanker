import { describe, expect, it } from 'vitest';
import {
  applyStartupAttentionDebug,
  isDevVersion,
  shouldEnableAttentionDebug,
  shouldEnableChildProcessCrashLogging,
} from '../../../src/main/attentionDebug';

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

describe('dev version detection', () => {
  it('identifies -dev prereleases correctly', () => {
    expect(isDevVersion('0.12.0-dev.db51b43')).toBe(true);
    expect(isDevVersion('0.12.0-dev-12345')).toBe(true);
    expect(isDevVersion('1.0.0-dev')).toBe(true);
    expect(isDevVersion('0.12.0')).toBe(false);
    expect(isDevVersion('0.12.0-rc.1')).toBe(false);
  });
});

describe('child process crash logging defaults', () => {
  it('enables crash logging when NODE_ENV is development', () => {
    expect(shouldEnableChildProcessCrashLogging('development', false, '0.12.0')).toBe(true);
  });

  it('enables crash logging when debug mode is active', () => {
    expect(shouldEnableChildProcessCrashLogging('production', true, '0.12.0')).toBe(true);
    expect(shouldEnableChildProcessCrashLogging(undefined, true, '0.12.0')).toBe(true);
  });

  it('enables crash logging for packaged dev-version builds', () => {
    expect(shouldEnableChildProcessCrashLogging('production', false, '0.12.0-dev.db51b43')).toBe(true);
    expect(shouldEnableChildProcessCrashLogging(undefined, false, '0.12.0-dev.1')).toBe(true);
  });

  it('stays quiet in production releases without debug flags', () => {
    expect(shouldEnableChildProcessCrashLogging('production', false, '0.12.0')).toBe(false);
    expect(shouldEnableChildProcessCrashLogging(undefined, false, '0.12.0')).toBe(false);
    expect(shouldEnableChildProcessCrashLogging(undefined, false, '0.12.0-rc.1')).toBe(false);
  });
});

describe('startup attention debug application', () => {
  it('mutates process.env for unpackaged development runs', () => {
    const env: NodeJS.ProcessEnv = {};
    applyStartupAttentionDebug(env, false, '0.12.0');
    expect(env.CLANKER_DEBUG_ATTENTION).toBe('1');
  });

  it('mutates process.env for packaged dev-version builds', () => {
    const env: NodeJS.ProcessEnv = {};
    applyStartupAttentionDebug(env, true, '0.12.0-dev.db51b43');
    expect(env.CLANKER_DEBUG_ATTENTION).toBe('1');
  });

  it('does not mutate process.env for packaged stable releases', () => {
    const env: NodeJS.ProcessEnv = {};
    applyStartupAttentionDebug(env, true, '0.12.0');
    expect(env.CLANKER_DEBUG_ATTENTION).toBeUndefined();
  });

  it('preserves explicit opt-out on unpackaged and dev-version runs', () => {
    const devEnv: NodeJS.ProcessEnv = { CLANKER_DEBUG_ATTENTION: '0' };
    applyStartupAttentionDebug(devEnv, false, '0.12.0');
    expect(devEnv.CLANKER_DEBUG_ATTENTION).toBe('0');

    const pkgDevEnv: NodeJS.ProcessEnv = { CLANKER_DEBUG_ATTENTION: '0' };
    applyStartupAttentionDebug(pkgDevEnv, true, '0.12.0-dev.db51b43');
    expect(pkgDevEnv.CLANKER_DEBUG_ATTENTION).toBe('0');
  });

  it('preserves explicit opt-in on packaged stable releases', () => {
    const env: NodeJS.ProcessEnv = { CLANKER_DEBUG_ATTENTION: '1' };
    applyStartupAttentionDebug(env, true, '0.12.0');
    expect(env.CLANKER_DEBUG_ATTENTION).toBe('1');
  });
});
