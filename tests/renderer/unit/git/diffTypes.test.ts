// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { initialDiffViewerState } from '../../../../src/renderer/components/git/diffTypes';

describe('diffTypes', () => {
  describe('initialDiffViewerState', () => {
    it('has isOpen set to false', () => {
      expect(initialDiffViewerState.isOpen).toBe(false);
    });

    it('has filePath set to null', () => {
      expect(initialDiffViewerState.filePath).toBeNull();
    });

    it('has isLoading set to false', () => {
      expect(initialDiffViewerState.isLoading).toBe(false);
    });

    it('has error set to null', () => {
      expect(initialDiffViewerState.error).toBeNull();
    });

    it('has all string fields set to empty strings', () => {
      expect(initialDiffViewerState.oldContent).toBe('');
      expect(initialDiffViewerState.newContent).toBe('');
      expect(initialDiffViewerState.oldPath).toBe('');
      expect(initialDiffViewerState.newPath).toBe('');
    });

    it('has all boolean fields set to false', () => {
      expect(initialDiffViewerState.isBinary).toBe(false);
      expect(initialDiffViewerState.hasDiff).toBe(false);
    });
  });
});
