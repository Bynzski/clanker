import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

const APP_BROWSER_PROTOCOLS = new Set(['http:', 'https:']);
const TRUSTED_APP_BROWSER_PROTOCOLS = new Set(['http:', 'https:', 'file:']);
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function normalizeUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl.trim());
  } catch {
    return null;
  }
}

export function normalizeAppBrowserUrl(rawUrl: string): string | null {
  const parsedUrl = normalizeUrl(rawUrl);
  if (!parsedUrl || !APP_BROWSER_PROTOCOLS.has(parsedUrl.protocol)) {
    return null;
  }
  return parsedUrl.toString();
}

function isWindowsDrivePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value);
}

function normalizeWindowsDrivePathUrl(value: string): string {
  return `file:///${value.replace(/\\/g, '/')}`;
}

function normalizeAbsolutePathUrl(value: string): string | null {
  if (isWindowsDrivePath(value)) {
    return normalizeWindowsDrivePathUrl(value);
  }

  if (!path.isAbsolute(value)) {
    return null;
  }

  return pathToFileURL(value).toString();
}

function normalizeFileBrowserUrl(parsedUrl: URL): string | null {
  if (parsedUrl.hostname && parsedUrl.hostname !== 'localhost') {
    return null;
  }
  return parsedUrl.toString();
}

/**
 * Normalize URLs initiated by trusted app UI/IPC browser navigation.
 *
 * Keep untrusted web-initiated navigation on normalizeAppBrowserUrl() so remote
 * pages cannot pivot into local file access, while still allowing the app's
 * address bar and tab APIs to load explicit file:// URLs or absolute paths.
 */
export function normalizeTrustedAppBrowserUrl(rawUrl: string): string | null {
  const trimmedUrl = rawUrl.trim();
  if (!trimmedUrl) {
    return null;
  }

  const localPathUrl = normalizeAbsolutePathUrl(trimmedUrl);
  if (localPathUrl) {
    return localPathUrl;
  }

  const parsedUrl = normalizeUrl(trimmedUrl);
  if (!parsedUrl || !TRUSTED_APP_BROWSER_PROTOCOLS.has(parsedUrl.protocol)) {
    return null;
  }

  if (parsedUrl.protocol === 'file:') {
    return normalizeFileBrowserUrl(parsedUrl);
  }

  return parsedUrl.toString();
}

export function normalizeExternalUrl(rawUrl: string): string | null {
  const parsedUrl = normalizeUrl(rawUrl);
  if (!parsedUrl || !EXTERNAL_PROTOCOLS.has(parsedUrl.protocol)) {
    return null;
  }
  return parsedUrl.toString();
}

export function resolveExistingDirectory(dirPath: string, fallback?: string): string | null {
  const candidates = [dirPath, fallback].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  for (const candidate of candidates) {
    const resolvedPath = path.resolve(candidate);
    try {
      if (fs.statSync(resolvedPath).isDirectory()) {
        return resolvedPath;
      }
    } catch {
      // try the next candidate
    }
  }

  return null;
}
