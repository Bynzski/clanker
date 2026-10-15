import { app, crashReporter } from 'electron';
import { isDevVersion } from './attentionDebug';

/** Call before readiness or child creation. No upload endpoint or custom memory data. */
export function startCrashDiagnostics(env: NodeJS.ProcessEnv = process.env): void {
  const configured = env.CLANKER_CRASH_DUMPS;
  const enabled = configured === undefined
    ? !app.isPackaged || isDevVersion(app.getVersion())
    : configured === '1';
  if (!enabled) return;

  try {
    crashReporter.start({
      uploadToServer: false,
      // Keep OS-level crash handling available as a second source of evidence.
      ignoreSystemCrashHandler: false,
    });
    console.info(`[clanker-grid] Local-only crash dumps enabled: ${app.getPath('crashDumps')}`);
  } catch (error: unknown) {
    // Diagnostic setup must not prevent application startup.
    console.warn('[clanker-grid] Local crash dump capture could not start:', error);
  }
}
