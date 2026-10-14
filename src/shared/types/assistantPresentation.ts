import type { AssistantRead } from './assistantDetails';

/** Native Bot Mode cosmetics only. No operational role description, raw metadata or profile paths. */
export const ASSISTANT_TITLE_LIMIT = 80;
export const ASSISTANT_TAGLINE_LIMIT = 200;
export interface AssistantCosmetics {
  title: string;
  tagline: string;
  /** Main-owned edit snapshot, bound to this local profile and connection. Absent without safe CAS support. */
  editToken?: string;
}
export interface AssistantPresentation {
  assistantId: string;
  cosmetics: AssistantRead<AssistantCosmetics>;
}
export interface AssistantPresentationUpdate {
  editToken: string;
  title: string;
  tagline: string;
}
export interface AssistantPresentationWriteResult {
  state: 'saved' | 'conflict' | 'unsupported' | 'invalid' | 'offline' | 'unavailable' | 'error';
  /** Authoritative re-read, never an optimistic echo of renderer input. */
  presentation?: AssistantPresentation;
}
/** Main decodes and re-encodes a bounded thumbnail. Only a normalized PNG data URL reaches the UI. */
export type AssistantAvatar = AssistantRead<{ dataUrl: string; width: number; height: number } | null>;
