import { describe, it, expect } from 'vitest';
import { isAbsoluteWorkspacePath, isUncPath, isWindowsDrivePath } from '../../../src/shared/pathClassify';

describe('pathClassify', () => {
  it('detects Windows drive-letter paths', () => {
    expect(isWindowsDrivePath('C:/Users/jay')).toBe(true);
    expect(isWindowsDrivePath('d:/repo')).toBe(true);
    expect(isWindowsDrivePath('/tmp/repo')).toBe(false);
  });

  it('detects UNC paths', () => {
    expect(isUncPath('//server/share/repo')).toBe(true);
    expect(isUncPath('/workspace')).toBe(false);
  });

  it('classifies absolute workspace paths', () => {
    expect(isAbsoluteWorkspacePath('/workspace')).toBe(true);
    expect(isAbsoluteWorkspacePath('C:/workspace')).toBe(true);
    expect(isAbsoluteWorkspacePath('//server/share/workspace')).toBe(true);
    expect(isAbsoluteWorkspacePath('relative/path')).toBe(false);
  });
});
