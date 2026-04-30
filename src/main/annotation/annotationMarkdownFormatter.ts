/**
 * Annotation Markdown Formatter
 *
 * Pure-function module for formatting annotation data as structured Markdown
 * suitable for clipboard export into agent windows.
 *
 * Extracted from annotationController.ts to reduce complexity and enable
 * independent testing of formatting logic.
 */

import type { AnnotationData } from './annotationController';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function formatInlineCodeList(values: string[]): string {
  return values.map((v) => `\`${v}\``).join(', ');
}

function formatTextList(values: string[]): string {
  return values.map((v) => `\`${v}\``).join('; ');
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildHeaderLines(capture: AnnotationData): string[] {
  return [
    '## Page Annotation',
    '',
    `- URL: ${capture.url}`,
    `- Title: ${capture.title}`,
    `- Captured At: ${capture.timestamp}`,
  ];
}

function buildElementLines(capture: AnnotationData): string[] {
  const lines: string[] = [
    '',
    '### Selected Element',
    `- Tag: \`${capture.tagName.toLowerCase()}\``,
    `- Primary Selector: \`${capture.selector}\``,
  ];

  if (capture.fallbackSelectors.length > 0) {
    lines.push(`- Fallback Selectors: ${formatInlineCodeList(capture.fallbackSelectors.slice(0, 4))}`);
  }

  if (capture.id) {
    lines.push(`- ID: ${capture.id}`);
  }

  if (capture.className) {
    const classes = capture.className
      .split(' ')
      .filter((c) => c && !c.match(/^_/))
      .slice(0, 5);
    if (classes.length > 0) {
      lines.push(`- Classes: ${classes.join(' ')}`);
    }
  }

  if (capture.text) {
    lines.push(`- Text: ${capture.text.slice(0, 100)}`);
  }

  if (capture.role) {
    lines.push(`- Role: ${capture.role}`);
  }

  if (capture.accessibleName) {
    lines.push(`- Accessible Name: ${capture.accessibleName}`);
  }

  lines.push(
    `- Bounds: x=${Math.round(capture.bounds.x)} y=${Math.round(capture.bounds.y)} w=${Math.round(capture.bounds.width)} h=${Math.round(capture.bounds.height)}`
  );

  return lines;
}

function buildContextLines(capture: AnnotationData): string[] {
  const lines: string[] = ['', '### Context'];

  if (capture.elementRoleInContext) {
    lines.push(`- Element Role: ${capture.elementRoleInContext}`);
  }

  if (capture.uiRegion) {
    lines.push(`- UI Region: ${capture.uiRegion}`);
  }

  if (capture.ancestorContext) {
    lines.push(`- Ancestor Context: ${capture.ancestorContext}`);
  }

  if (capture.nearbyText.length > 0) {
    lines.push(`- Nearby Text: ${formatTextList(capture.nearbyText.slice(0, 4))}`);
  }

  // If nothing was detected, provide a fallback
  if (
    !capture.elementRoleInContext &&
    !capture.uiRegion &&
    !capture.ancestorContext &&
    capture.nearbyText.length === 0
  ) {
    lines.push(`- Element Role: ${capture.tagName.toLowerCase()} (not further classified)`);
  }

  return lines;
}

function buildAttributesLines(capture: AnnotationData): string[] {
  if (Object.keys(capture.attributes).length === 0) {
    return [];
  }

  const lines: string[] = ['', '### Attributes'];
  for (const [key, value] of Object.entries(capture.attributes).slice(0, 10)) {
    lines.push(`- ${key}: ${value}`);
  }

  return lines;
}

function buildAnnotationLines(capture: AnnotationData): string[] {
  const trimmedNote = capture.note.trim();
  return ['', '### Annotation', trimmedNote.length > 0 ? trimmedNote : '_No note provided._'];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Format annotation as Markdown for clipboard export.
 * Structured format suitable for pasting into an agent window.
 */
export function formatAnnotationMarkdown(capture: AnnotationData): string {
  const lines: string[] = [
    ...buildHeaderLines(capture),
    ...buildElementLines(capture),
    ...buildContextLines(capture),
    ...buildAttributesLines(capture),
    ...buildAnnotationLines(capture),
  ];

  return lines.join('\n');
}
