import { describe, expect, it } from 'vitest';
import { mapRawCaptureToAnnotationData, type RawCaptureResult } from '../../../../src/main/annotation/annotationCaptureParser';

describe('annotationCaptureParser', () => {
  describe('mapRawCaptureToAnnotationData', () => {
    it('maps a complete raw result to AnnotationData', () => {
      const raw: RawCaptureResult = {
        url: 'https://example.com',
        title: 'Example',
        tagName: 'BUTTON',
        selector: '#save',
        fallbackSelectors: ['.primary'],
        id: 'save',
        className: 'primary',
        text: 'Save',
        role: 'button',
        accessibleName: 'Save',
        attributes: { 'data-testid': 'save' },
        bounds: { x: 1, y: 2, width: 3, height: 4 },
        uiRegion: 'toolbar',
        elementRoleInContext: 'action button',
        nearbyText: ['Cancel'],
        ancestorContext: 'main toolbar',
        note: 'test note',
        timestamp: '2026-01-01T00:00:00.000Z',
      };

      const result = mapRawCaptureToAnnotationData(raw);
      expect(result).toEqual({
        url: 'https://example.com',
        title: 'Example',
        tagName: 'BUTTON',
        selector: '#save',
        fallbackSelectors: ['.primary'],
        id: 'save',
        className: 'primary',
        text: 'Save',
        role: 'button',
        accessibleName: 'Save',
        attributes: { 'data-testid': 'save' },
        bounds: { x: 1, y: 2, width: 3, height: 4 },
        uiRegion: 'toolbar',
        elementRoleInContext: 'action button',
        nearbyText: ['Cancel'],
        ancestorContext: 'main toolbar',
        note: 'test note',
        timestamp: '2026-01-01T00:00:00.000Z',
      });
    });

    it('applies defaults for missing optional fields', () => {
      const raw: RawCaptureResult = {
        url: 'https://example.com',
        selector: '#main',
      };

      const result = mapRawCaptureToAnnotationData(raw);
      expect(result.title).toBe('');
      expect(result.tagName).toBe('UNKNOWN');
      expect(result.fallbackSelectors).toEqual([]);
      expect(result.id).toBeNull();
      expect(result.className).toBeNull();
      expect(result.text).toBeNull();
      expect(result.role).toBeNull();
      expect(result.accessibleName).toBeNull();
      expect(result.attributes).toEqual({});
      expect(result.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
      expect(result.uiRegion).toBeNull();
      expect(result.elementRoleInContext).toBeNull();
      expect(result.nearbyText).toEqual([]);
      expect(result.ancestorContext).toBeNull();
      expect(result.note).toBe('');
      expect(result.timestamp).toBeTruthy();
    });

    it('uses empty string as fallback for null id', () => {
      const raw: RawCaptureResult = {
        url: 'https://example.com',
        selector: '#x',
        id: null,
      };
      const result = mapRawCaptureToAnnotationData(raw);
      expect(result.id).toBeNull();
    });

    it('preserves explicit empty string id as null', () => {
      const raw: RawCaptureResult = {
        url: 'https://example.com',
        selector: '#x',
        id: '',
      };
      const result = mapRawCaptureToAnnotationData(raw);
      expect(result.id).toBeNull();
    });
  });
});
