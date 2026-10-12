import { describe, it, expect } from 'vitest';
import { isUncPath } from '../../../src/shared/pathClassify';

describe('pathClassify', () => {
  it('detects UNC paths', () => {
    expect(isUncPath('//server/share/repo')).toBe(true);
    expect(isUncPath('/workspace')).toBe(false);
  });

});
