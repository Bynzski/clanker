import { describe, expect, it } from 'vitest';
import { computeFilterVisibility } from '../../../../src/renderer/components/FileExplorer/filterVisibility';
import type { FileExplorerEntry } from '../../../../src/shared/types/fileExplorer';

function entry(name: string, path: string, isDirectory = false): FileExplorerEntry {
  return { name, path, isDirectory, size: 0, modified: 0 };
}

describe('computeFilterVisibility', () => {
  const tree: Record<string, FileExplorerEntry[]> = {
    '/ws': [
      entry('src', '/ws/src', true),
      entry('docs', '/ws/docs', true),
      entry('README.md', '/ws/README.md'),
    ],
    '/ws/src': [
      entry('index.ts', '/ws/src/index.ts'),
      entry('utils.ts', '/ws/src/utils.ts'),
    ],
    '/ws/docs': [
      entry('guide.md', '/ws/docs/guide.md'),
    ],
  };

  it('returns an inactive state for an empty query', () => {
    const result = computeFilterVisibility('/ws', tree, '', true);
    expect(result.active).toBe(false);
    expect(result.visiblePaths.size).toBe(0);
  });

  it('returns an inactive state for a whitespace-only query', () => {
    const result = computeFilterVisibility('/ws', tree, '   ', true);
    expect(result.active).toBe(false);
  });

  it('includes matching files and their ancestor directories', () => {
    const result = computeFilterVisibility('/ws', tree, 'utils', true);
    expect(result.active).toBe(true);
    expect(result.visiblePaths.has('/ws/src/utils.ts')).toBe(true);
    expect(result.visiblePaths.has('/ws/src')).toBe(true);
    expect(result.visiblePaths.has('/ws/README.md')).toBe(false);
    expect(result.visiblePaths.has('/ws/docs')).toBe(false);
  });

  it('matches case-insensitively', () => {
    const result = computeFilterVisibility('/ws', tree, 'README', true);
    expect(result.visiblePaths.has('/ws/README.md')).toBe(true);

    const lower = computeFilterVisibility('/ws', tree, 'readme', true);
    expect(lower.visiblePaths.has('/ws/README.md')).toBe(true);
  });

  it('force-expands directories that have matching descendants', () => {
    const result = computeFilterVisibility('/ws', tree, 'guide', true);
    expect(result.forcedExpanded.has('/ws/docs')).toBe(true);
    expect(result.forcedExpanded.has('/ws/src')).toBe(false);
  });

  it('records direct matches separately for highlighting', () => {
    const result = computeFilterVisibility('/ws', tree, 'src', true);
    expect(result.matchingPaths.has('/ws/src')).toBe(true);
    // A directly-matching directory should still expose its loaded descendants
    // as visible so the user can see what is inside.
    expect(result.visiblePaths.has('/ws/src')).toBe(true);
  });

  it('hides dotfiles when showHidden is false', () => {
    const withDotfile: Record<string, FileExplorerEntry[]> = {
      '/ws': [
        entry('.env', '/ws/.env'),
        entry('env.config.ts', '/ws/env.config.ts'),
      ],
    };
    const result = computeFilterVisibility('/ws', withDotfile, 'env', false);
    expect(result.visiblePaths.has('/ws/.env')).toBe(false);
    expect(result.visiblePaths.has('/ws/env.config.ts')).toBe(true);
  });

  it('returns empty visible set for non-matching queries', () => {
    const result = computeFilterVisibility('/ws', tree, 'zzz-nope', true);
    expect(result.active).toBe(true);
    expect(result.visiblePaths.size).toBe(0);
  });

  it('does not recurse into directories whose children are not loaded', () => {
    const partial: Record<string, FileExplorerEntry[]> = {
      '/ws': [entry('lib', '/ws/lib', true)],
      // '/ws/lib' intentionally not loaded
    };
    const result = computeFilterVisibility('/ws', partial, 'anything', true);
    // lib does not match by name and its contents are unknown, so it's hidden.
    expect(result.visiblePaths.has('/ws/lib')).toBe(false);
  });
});
