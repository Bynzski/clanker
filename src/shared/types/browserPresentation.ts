/** Renderer-issued presentation lease, not a resource/security owner. */
export interface BrowserPresentation {
  paneId: string;
  /** Monotonically increasing across all Browser owners in this renderer lifetime. */
  epoch: number;
}
