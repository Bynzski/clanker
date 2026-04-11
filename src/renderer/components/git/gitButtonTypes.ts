export type DeleteDialogStage = 'confirm' | 'force';

export interface DeleteDialogState {
  branch: string;
  stage: DeleteDialogStage;
  detail?: string;
}

export type RemoteAction = 'fetch' | 'pull' | 'push' | 'publish' | null;
