import * as fs from 'fs';
import * as path from 'path';

const APP_BROWSER_PROTOCOLS = new Set(['http:', 'https:']);
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
