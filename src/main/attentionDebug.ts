/** Development/preview builds default to bounded attention logs; stable packaged releases do not. */
export function shouldEnableAttentionDebug(
  configuredValue: string | undefined,
  isPackaged: boolean,
  appVersion: string,
): boolean {
  // Explicit environment configuration always wins, including an explicit opt-out.
  if (configuredValue !== undefined) return configuredValue === '1';
  return !isPackaged || /-dev(?:[.+-]|$)/i.test(appVersion);
}
