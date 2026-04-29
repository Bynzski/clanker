// Re-export the canonical normalizers from the shared module.
// The renderer uses toPosixPath internally; toNativePath is available
// for any renderer code that needs to send native paths to main.
export { toPosixPath, toNativePath } from '../../shared/pathNormalize';

function normalizeSeparators(value: string): string {
  return value.replace(/\\/g, '/');
}

function trimTrailingSlash(value: string): string {
  if (value.length <= 1) {
    return value;
  }

  if (/^[A-Za-z]:\/$/.test(value)) {
    return value;
  }

  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function parsePath(path: string): { root: string; segments: string[]; absolute: boolean } {
  const normalized = normalizeSeparators(path);

  if (/^[A-Za-z]:\//.test(normalized)) {
    return {
      root: normalized.slice(0, 3).toLowerCase(),
      segments: normalized.slice(3).split('/').filter(Boolean),
      absolute: true,
    };
  }

  if (normalized.startsWith('/')) {
    return {
      root: '/',
      segments: normalized.slice(1).split('/').filter(Boolean),
      absolute: true,
    };
  }

  return {
    root: '',
    segments: normalized.split('/').filter(Boolean),
    absolute: false,
  };
}

export function normalizePath(path: string): string {
  const normalized = normalizeSeparators(path);
  return trimTrailingSlash(normalized);
}

export function isAbsolutePath(path: string): boolean {
  return parsePath(path).absolute;
}

export function joinPaths(basePath: string, childName: string): string {
  const normalizedBase = normalizePath(basePath);
  const normalizedChild = normalizeSeparators(childName).replace(/^\/+/, '');

  if (normalizedChild.length === 0) {
    return normalizedBase;
  }

  if (normalizedBase === '' || normalizedBase === '.') {
    return normalizedChild;
  }

  return normalizedBase.endsWith('/')
    ? `${normalizedBase}${normalizedChild}`
    : `${normalizedBase}/${normalizedChild}`;
}

export function dirnamePath(path: string): string {
  const normalized = normalizePath(path);
  const parsed = parsePath(normalized);

  if (parsed.segments.length === 0) {
    return normalized;
  }

  const nextSegments = parsed.segments.slice(0, -1);
  if (nextSegments.length === 0) {
    return parsed.root || '.';
  }

  return `${parsed.root}${nextSegments.join('/')}`;
}

export function relativePath(basePath: string, targetPath: string): string {
  const base = parsePath(normalizePath(basePath));
  const target = parsePath(normalizePath(targetPath));

  if (base.absolute !== target.absolute || base.root !== target.root) {
    return normalizePath(targetPath);
  }

  let sharedSegments = 0;
  while (
    sharedSegments < base.segments.length &&
    sharedSegments < target.segments.length &&
    base.segments[sharedSegments] === target.segments[sharedSegments]
  ) {
    sharedSegments += 1;
  }

  if (sharedSegments < base.segments.length) {
    return normalizePath(targetPath);
  }

  return target.segments.slice(sharedSegments).join('/');
}
