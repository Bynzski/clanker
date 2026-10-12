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

/** Diagnostic child process crash logs activate in development, debug mode, or dev-version builds. */
export function shouldEnableChildProcessCrashLogging(
  nodeEnv: string | undefined,
  isDebug: boolean,
  appVersion: string,
): boolean {
  return nodeEnv === 'development' || isDebug || isDevVersion(appVersion);
}
