import { toPosixPath } from './pathNormalize';

function runtimeIsWindows(): boolean {
  const maybeProcess = globalThis as { process?: { platform?: string } };
  if (maybeProcess.process?.platform) {
    return maybeProcess.process.platform === 'win32';
  }

  const maybeNavigator = globalThis as { navigator?: { userAgent?: string } };
  return maybeNavigator.navigator?.userAgent?.includes('Windows') ?? false;
}

export function pathKey(inputPath: string, isWindows: boolean = runtimeIsWindows()): string {
  const normalized = toPosixPath(inputPath);
  return isWindows ? normalized.toLowerCase() : normalized;
}
