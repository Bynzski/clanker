/** Returns true if the version string indicates a development/preview prerelease. */
export function isDevVersion(appVersion: string): boolean {
  return /-dev(?:[.+-]|$)/i.test(appVersion);
}

/** Development/preview builds default to bounded attention logs; stable packaged releases do not. */
export function shouldEnableAttentionDebug(
  configuredValue: string | undefined,
  isPackaged: boolean,
  appVersion: string,
): boolean {
  // Explicit environment configuration always wins, including an explicit opt-out.
  if (configuredValue !== undefined) return configuredValue === '1';
  return !isPackaged || isDevVersion(appVersion);
}

/** Applies attention debug logging to process.env during main-process startup. */
export function applyStartupAttentionDebug(
  env: NodeJS.ProcessEnv,
  isPackaged: boolean,
  appVersion: string,
): void {
  if (shouldEnableAttentionDebug(env.CLANKER_DEBUG_ATTENTION, isPackaged, appVersion)) {
    env.CLANKER_DEBUG_ATTENTION = '1';
  }
}

/** Diagnostic child process crash logs activate in development, debug mode, or dev-version builds. */
export function shouldEnableChildProcessCrashLogging(
  nodeEnv: string | undefined,
  isDebug: boolean,
  appVersion: string,
): boolean {
  return nodeEnv === 'development' || isDebug || isDevVersion(appVersion);
}
