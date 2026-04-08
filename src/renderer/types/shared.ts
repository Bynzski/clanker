import type { VcsProvider } from '../../shared/types/vcs';

export interface ModelOption {
  id: string;
  label: string;
}

export interface AiCommitSettings {
  enabled: boolean;
  provider: string;
  model: string;
}

export type { VcsProvider };

/**
 * Request to save a Personal Access Token.
 */
export interface SavePatRequest {
  provider: VcsProvider;
  token: string;
  scope?: string[];
}
