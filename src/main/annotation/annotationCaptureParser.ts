/**
 * Annotation Capture Result Parser
 *
 * Transforms raw executeJavaScript capture results into typed AnnotationData.
 * Extracted from annotationController.ts to reduce branching complexity in the
 * capture method and enable independent testing of result validation/mapping.
 */

import type { AnnotationData } from './annotationController';

/** Raw shape returned by the injected capture code in the browser view. */
export interface RawCaptureResult {
  error?: string;
  url?: string;
  title?: string;
  tagName?: string;
  selector?: string;
  fallbackSelectors?: string[];
  id?: string | null;
  className?: string | null;
  text?: string | null;
  role?: string | null;
  accessibleName?: string | null;
  attributes?: Record<string, string>;
  bounds?: { x: number; y: number; width: number; height: number };
  uiRegion?: string | null;
  elementRoleInContext?: string | null;
  nearbyText?: string[];
  ancestorContext?: string | null;
  note?: string;
  timestamp?: string;
}

/**
 * Map a validated raw capture result into a typed AnnotationData object.
 *
 * Callers must validate the result has `url` and `selector` before calling.
 */
export function mapRawCaptureToAnnotationData(raw: RawCaptureResult): AnnotationData {
  return {
    url: raw.url!,
    title: raw.title || '',
    tagName: raw.tagName || 'UNKNOWN',
    selector: raw.selector!,
    fallbackSelectors: raw.fallbackSelectors || [],
    id: raw.id || null,
    className: raw.className || null,
    text: raw.text || null,
    role: raw.role || null,
    accessibleName: raw.accessibleName || null,
    attributes: raw.attributes || {},
    bounds: raw.bounds || { x: 0, y: 0, width: 0, height: 0 },
    uiRegion: raw.uiRegion || null,
    elementRoleInContext: raw.elementRoleInContext || null,
    nearbyText: raw.nearbyText || [],
    ancestorContext: raw.ancestorContext || null,
    note: raw.note || '',
    timestamp: raw.timestamp || new Date().toISOString(),
  };
}
