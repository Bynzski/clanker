import { isAbsolutePath } from './pathUtils';

export type TerminalLinkKind = 'file' | 'url';

export interface TerminalLinkMatch {
  kind: TerminalLinkKind;
  text: string;
  target: string;
  startIndex: number;
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/giu;
const FILE_PATTERN = /(?:[A-Za-z]:[\\/][^\s<>"'`|]+|(?:\\\\|\/\/)[^\s<>"'`|]+|(?:\.{1,2}[\\/]|\/)[^\s<>"'`|]+|(?:[A-Za-z0-9_@+.-]+[\\/])+(?:[A-Za-z0-9_@+().-]+)(?::\d+){0,2})/g;
const FILE_LOCATION_SUFFIX = /(?::\d+){1,2}$/;
const FILE_FRAGMENT_SUFFIX = /#L\d+(?:C\d+)?$/i;

function trimTrailingPunctuation(value: string): string {
  let result = value.replace(/[.,;!?]+$/g, '');
  const pairs = [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
  ] as const;

  for (const [open, close] of pairs) {
    while (result.endsWith(close)) {
      const openCount = result.split(open).length - 1;
      const closeCount = result.split(close).length - 1;
      if (closeCount <= openCount) break;
      result = result.slice(0, -1);
    }
  }

  return result;
}

export function normalizeTerminalUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

interface CanonicalPath {
  value: string;
  comparisonValue: string;
  absolute: boolean;
}

function canonicalizePath(value: string): CanonicalPath | null {
  const normalized = value.trim().replace(/\\/g, '/');
  if (!normalized || normalized.includes('\0')) return null;

  let root = '';
  let remainder = normalized;
  let caseInsensitive = false;

  const driveMatch = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  const uncMatch = /^\/\/([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(normalized);

  if (driveMatch) {
    root = `${driveMatch[1]!.toUpperCase()}:/`;
    remainder = driveMatch[2] ?? '';
    caseInsensitive = true;
  } else if (uncMatch) {
    root = `//${uncMatch[1]}/${uncMatch[2]}/`;
    remainder = uncMatch[3] ?? '';
    caseInsensitive = true;
  } else if (normalized.startsWith('/')) {
    root = '/';
    remainder = normalized.slice(1);
  }

  const segments: string[] = [];
  for (const segment of remainder.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) {
        if (root) return null;
        segments.push(segment);
      } else if (segments[segments.length - 1] === '..') {
        segments.push(segment);
      } else {
        segments.pop();
      }
      continue;
    }
    segments.push(segment);
  }

  const pathValue = root
    ? `${root}${segments.join('/')}`.replace(/\/$/, segments.length === 0 ? '/' : '')
    : segments.join('/');

  return {
    value: pathValue,
    comparisonValue: caseInsensitive ? pathValue.toLowerCase() : pathValue,
    absolute: root.length > 0,
  };
}

/**
 * Resolve a terminal file reference against the workspace and reject paths
 * that escape it. Paths crossing IPC stay in canonical POSIX form.
 */
export function resolveTerminalFilePath(rawPath: string, workspacePath: string): string | null {
  const reference = trimTrailingPunctuation(rawPath)
    .replace(FILE_FRAGMENT_SUFFIX, '')
    .replace(FILE_LOCATION_SUFFIX, '');
  const workspace = canonicalizePath(workspacePath);
  if (!workspace?.absolute) return null;

  const candidate = isAbsolutePath(reference)
    ? canonicalizePath(reference)
    : canonicalizePath(`${workspace.value}/${reference}`);
  if (!candidate?.absolute) return null;

  const workspacePrefix = workspace.comparisonValue.endsWith('/')
    ? workspace.comparisonValue
    : `${workspace.comparisonValue}/`;
  if (
    candidate.comparisonValue !== workspace.comparisonValue
    && !candidate.comparisonValue.startsWith(workspacePrefix)
  ) {
    return null;
  }

  return candidate.value;
}

function rangesOverlap(start: number, length: number, matches: TerminalLinkMatch[]): boolean {
  const end = start + length;
  return matches.some((match) => {
    const matchEnd = match.startIndex + match.text.length;
    return start < matchEnd && end > match.startIndex;
  });
}

/** Detect safe HTTP(S) URLs and workspace-contained file references in one terminal row. */
export function findTerminalLinks(line: string, workspacePath: string): TerminalLinkMatch[] {
  const matches: TerminalLinkMatch[] = [];

  for (const match of line.matchAll(URL_PATTERN)) {
    const rawText = match[0];
    const text = trimTrailingPunctuation(rawText);
    const target = normalizeTerminalUrl(text);
    if (!target || match.index == null) continue;
    matches.push({ kind: 'url', text, target, startIndex: match.index });
  }

  for (const match of line.matchAll(FILE_PATTERN)) {
    const rawText = match[0];
    const text = trimTrailingPunctuation(rawText);
    const startIndex = match.index;
    if (startIndex == null || rangesOverlap(startIndex, text.length, matches)) continue;

    const target = resolveTerminalFilePath(text, workspacePath);
    if (!target) continue;
    matches.push({ kind: 'file', text, target, startIndex });
  }

  return matches.sort((left, right) => left.startIndex - right.startIndex);
}
