export interface ModelOption {
  id: string;
  label: string;
}

export interface AiCommitSettings {
  enabled: boolean;
  provider: string;
  model: string;
}

/**
 * Request to save a Personal Access Token.
 */
export interface SavePatRequest {
  provider: import('../../shared/types/vcs').VcsProvider;
  token: string;
  scope?: string[];
}
