import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { toRelativePath } from '../../../../src/renderer/components/FileExplorer/FileTree';

describe('toRelativePath', () => {
  it('returns slash-separated relative paths for nested entries', () => {
    expect(toRelativePath('/workspace/src/index.ts', '/workspace', path.posix)).toBe('src/index.ts');
  });

  it('preserves Windows relative path semantics', () => {
    expect(
      toRelativePath('C:\\workspace\\src\\index.ts', 'C:\\workspace', path.win32)
    ).toBe('src/index.ts');
  });

  it('falls back to the absolute path when the entry is outside the workspace', () => {
    expect(toRelativePath('/other/index.ts', '/workspace', path.posix)).toBe('/other/index.ts');
  });
});
