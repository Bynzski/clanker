/**
 * Annotation Module
 *
 * Browser annotation feature for selecting elements, adding notes, and
 * exporting structured annotations for coding agents.
 */

export {
  createAnnotationController,
  formatAnnotationMarkdown,
  type AnnotationController,
  type AnnotationState,
  type AnnotationCaptureResult,
  type AnnotationData,
} from './annotationController';

export {
  registerAnnotationIpc,
} from './annotationIpc';

export {
  generateAnnotationRuntime,
  generateCaptureCode,
  generateEnableCode,
  generateDisableCode,
  generateStatusCode,
  type ElementAnnotationData,
  type AnnotationRuntimeState,
} from './annotationRuntime';
