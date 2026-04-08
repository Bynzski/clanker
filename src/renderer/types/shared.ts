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
 * VCS Provider types for Git remote services.
 */
export type VcsProvider = 'github' | 'gitlab' | 'bitbucket' | 'unknown';

/**
 * Request to save a Personal Access Token.
 */
export interface SavePatRequest {
  provider: VcsProvider;
  token: string;
  scope?: string[];
}
