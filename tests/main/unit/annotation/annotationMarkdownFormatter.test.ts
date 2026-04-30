import { describe, expect, it } from 'vitest';
import { formatAnnotationMarkdown } from '../../../../src/main/annotation/annotationMarkdownFormatter';
import type { AnnotationData } from '../../../../src/main/annotation/annotationController';

function makeAnnotation(overrides: Partial<AnnotationData> = {}): AnnotationData {
  return {
    url: 'https://example.com',
    title: 'Example Page',
    tagName: 'BUTTON',
    selector: '#save',
    fallbackSelectors: [],
    id: null,
    className: null,
    text: null,
    role: null,
    accessibleName: null,
    attributes: {},
    bounds: { x: 10, y: 20, width: 100, height: 40 },
    uiRegion: null,
    elementRoleInContext: null,
    nearbyText: [],
    ancestorContext: null,
    note: '',
    timestamp: '2026-04-30T12:00:00.000Z',
    ...overrides,
  };
}

describe('annotationMarkdownFormatter', () => {
  describe('header section', () => {
    it('renders URL, title, and timestamp', () => {
      const md = formatAnnotationMarkdown(makeAnnotation());
      expect(md).toContain('- URL: https://example.com');
      expect(md).toContain('- Title: Example Page');
      expect(md).toContain('- Captured At: 2026-04-30T12:00:00.000Z');
    });
  });

  describe('selected element section', () => {
    it('renders tag and selector', () => {
      const md = formatAnnotationMarkdown(makeAnnotation());
      expect(md).toContain('### Selected Element');
      expect(md).toContain('- Tag: `button`');
      expect(md).toContain('- Primary Selector: `#save`');
    });

    it('renders fallback selectors when present', () => {
      const md = formatAnnotationMarkdown(makeAnnotation({
        fallbackSelectors: ['.primary', '.cta'],
      }));
      expect(md).toContain('- Fallback Selectors: `.primary`, `.cta`');
    });

    it('omits fallback selectors when empty', () => {
      const md = formatAnnotationMarkdown(makeAnnotation());
      expect(md).not.toContain('Fallback Selectors');
    });

    it('renders id when present', () => {
      const md = formatAnnotationMarkdown(makeAnnotation({ id: 'save-btn' }));
      expect(md).toContain('- ID: save-btn');
    });

    it('renders filtered classes', () => {
      const md = formatAnnotationMarkdown(makeAnnotation({ className: 'primary _hash btn' }));
      expect(md).toContain('- Classes: primary btn');
    });

    it('omits classes when only underscore-prefixed', () => {
      const md = formatAnnotationMarkdown(makeAnnotation({ className: '_hash _abc' }));
      expect(md).not.toContain('- Classes:');
    });

    it('renders truncated text', () => {
      const longText = 'A'.repeat(200);
      const md = formatAnnotationMarkdown(makeAnnotation({ text: longText }));
      expect(md).toContain(`- Text: ${'A'.repeat(100)}`);
    });

    it('renders role and accessible name', () => {
      const md = formatAnnotationMarkdown(makeAnnotation({
        role: 'button',
        accessibleName: 'Save changes',
      }));
      expect(md).toContain('- Role: button');
      expect(md).toContain('- Accessible Name: Save changes');
    });

    it('renders rounded bounds', () => {
      const md = formatAnnotationMarkdown(makeAnnotation({
        bounds: { x: 10.7, y: 20.3, width: 100.5, height: 40.9 },
      }));
      expect(md).toContain('- Bounds: x=11 y=20 w=101 h=41');
    });
  });

  describe('context section', () => {
    it('renders all context fields when present', () => {
      const md = formatAnnotationMarkdown(makeAnnotation({
        elementRoleInContext: 'primary action',
        uiRegion: 'toolbar',
        ancestorContext: 'main toolbar',
        nearbyText: ['Cancel', 'Reset'],
      }));
      expect(md).toContain('- Element Role: primary action');
      expect(md).toContain('- UI Region: toolbar');
      expect(md).toContain('- Ancestor Context: main toolbar');
      expect(md).toContain('- Nearby Text: `Cancel`; `Reset`');
    });

    it('renders fallback element role when no context detected', () => {
      const md = formatAnnotationMarkdown(makeAnnotation({ tagName: 'SPAN' }));
      expect(md).toContain('- Element Role: span (not further classified)');
    });

    it('does not render fallback when any context is present', () => {
      const md = formatAnnotationMarkdown(makeAnnotation({ uiRegion: 'sidebar' }));
      expect(md).not.toContain('(not further classified)');
    });
  });

  describe('attributes section', () => {
    it('renders attributes when present', () => {
      const md = formatAnnotationMarkdown(makeAnnotation({
        attributes: { 'data-testid': 'save-btn', 'aria-label': 'Save' },
      }));
      expect(md).toContain('### Attributes');
      expect(md).toContain('- data-testid: save-btn');
      expect(md).toContain('- aria-label: Save');
    });

    it('omits attributes section when empty', () => {
      const md = formatAnnotationMarkdown(makeAnnotation());
      expect(md).not.toContain('### Attributes');
    });

    it('limits to 10 attributes', () => {
      const attrs: Record<string, string> = {};
      for (let i = 0; i < 15; i++) {
        attrs[`attr-${i}`] = `val-${i}`;
      }
      const md = formatAnnotationMarkdown(makeAnnotation({ attributes: attrs }));
      expect(md).toContain('- attr-9: val-9');
      expect(md).not.toContain('- attr-10:');
    });
  });

  describe('annotation section', () => {
    it('renders note text when present', () => {
      const md = formatAnnotationMarkdown(makeAnnotation({ note: '  important note  ' }));
      expect(md).toContain('### Annotation');
      expect(md).toContain('important note');
    });

    it('renders placeholder when note is empty', () => {
      const md = formatAnnotationMarkdown(makeAnnotation({ note: '' }));
      expect(md).toContain('### Annotation');
      expect(md).toContain('_No note provided._');
    });
  });

  describe('full round-trip', () => {
    it('matches expected structure for complete annotation', () => {
      const md = formatAnnotationMarkdown({
        url: 'https://github.com/',
        title: 'GitHub',
        tagName: 'DIV',
        selector: 'div:nth-of-type(1)',
        fallbackSelectors: ['.width-full.d-flex.mt-2'],
        id: null,
        className: 'width-full d-flex mt-2',
        text: 'Bynzski/clanker-built',
        role: null,
        accessibleName: null,
        attributes: {},
        bounds: { x: 24, y: 346, width: 257, height: 21 },
        uiRegion: 'Top repositories',
        elementRoleInContext: 'repository list entry',
        nearbyText: ['Bynzski/base_app', 'Bynzski/LandSnag'],
        ancestorContext: 'left sidebar repository list',
        note: 'this is a DIV',
        timestamp: '2026-04-13T14:51:03.803Z',
      });

      // Verify all major sections present
      expect(md).toContain('## Page Annotation');
      expect(md).toContain('### Selected Element');
      expect(md).toContain('### Context');
      expect(md).toContain('### Annotation');
      expect(md).toContain('Captured At: 2026-04-13T14:51:03.803Z');
      expect(md).toContain('Primary Selector: `div:nth-of-type(1)`');
      expect(md).toContain('Fallback Selectors: `.width-full.d-flex.mt-2`');
      expect(md).toContain('Element Role: repository list entry');
      expect(md).toContain('this is a DIV');
    });
  });
});
