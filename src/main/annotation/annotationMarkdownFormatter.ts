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

function pageText(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
}

function inlineCode(value: string): string {
  const content = pageText(value);
  const longestRun = (content.match(/`+/g) ?? []).reduce((longest, run) => Math.max(longest, run.length), 0);
  const fence = '`'.repeat(longestRun + 1);
  return `${fence}${content}${fence}`;
}

function formatInlineCodeList(values: string[]): string {
  return values.map(inlineCode).join(', ');
}

function formatTextList(values: string[]): string {
  return values.map(inlineCode).join('; ');
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildHeaderLines(capture: AnnotationData): string[] {
  return [
    '## Page Annotation',
    '',
    `- URL: ${pageText(capture.url)}`,
    `- Title: ${pageText(capture.title)}`,
    `- Captured At: ${pageText(capture.timestamp)}`,
  ];
}

function buildElementLines(capture: AnnotationData): string[] {
  const lines: string[] = [
    '',
    '### Selected Element',
    `- Tag: ${inlineCode(capture.tagName.toLowerCase())}`,
    `- Primary Selector: ${inlineCode(capture.selector)}`,
  ];

  if (capture.fallbackSelectors.length > 0) {
    lines.push(`- Fallback Selectors: ${formatInlineCodeList(capture.fallbackSelectors.slice(0, 4))}`);
  }

  if (capture.id) {
    lines.push(`- ID: ${pageText(capture.id)}`);
  }

  if (capture.className) {
    const classes = capture.className
      .split(' ')
      .filter((c) => c && !c.match(/^_/))
      .slice(0, 5);
    if (classes.length > 0) {
      lines.push(`- Classes: ${pageText(classes.join(' '))}`);
    }
  }

  if (capture.text) {
    lines.push(`- Text: ${pageText(capture.text.slice(0, 100))}`);
  }

  if (capture.role) {
    lines.push(`- Role: ${pageText(capture.role)}`);
  }

  if (capture.accessibleName) {
    lines.push(`- Accessible Name: ${pageText(capture.accessibleName)}`);
  }

  lines.push(
    `- Bounds: x=${Math.round(capture.bounds.x)} y=${Math.round(capture.bounds.y)} w=${Math.round(capture.bounds.width)} h=${Math.round(capture.bounds.height)}`
  );

  return lines;
}

function buildContextLines(capture: AnnotationData): string[] {
  if (!capture.elementRoleInContext && !capture.uiRegion && !capture.ancestorContext && capture.nearbyText.length === 0) {
    return [];
  }
  const lines: string[] = ['', '### Context'];

  if (capture.elementRoleInContext) {
    lines.push(`- Element Role: ${pageText(capture.elementRoleInContext)}`);
  }

  if (capture.uiRegion) {
    lines.push(`- UI Region: ${pageText(capture.uiRegion)}`);
  }

  if (capture.ancestorContext) {
    lines.push(`- Ancestor Context: ${pageText(capture.ancestorContext)}`);
  }

  if (capture.nearbyText.length > 0) {
    lines.push(`- Nearby Text: ${formatTextList(capture.nearbyText.slice(0, 4))}`);
  }

  return lines;
}

function buildAttributesLines(capture: AnnotationData): string[] {
  if (Object.keys(capture.attributes).length === 0) {
    return [];
  }

  const lines: string[] = ['', '### Attributes'];
  for (const [key, value] of Object.entries(capture.attributes).slice(0, 10)) {
    lines.push(`- ${pageText(key)}: ${pageText(value)}`);
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
