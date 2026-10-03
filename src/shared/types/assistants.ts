import type { WorkspaceLocation } from './environments';

/** Presentation preferences only. Hermes retains its profiles, credentials and conversations. */
export interface AssistantPin {
  harnessId: string;
  profileName: string;
  /** Absent means globally visible; a location pins visibility to a canonical workspace. */
  workspace?: WorkspaceLocation;
}

export interface AssistantSettings {
  enabled: boolean;
  pins: AssistantPin[];
}

export interface AssistantProfile {
  /** Main-owned opaque reference. Never a filesystem path or a renderer-owned launch command. */
  id: string;
  harnessId: string;
  profileName: string;
  label: string;
  description?: string;
}

export interface AssistantLaunchOwner {
  profileId: string;
  workspaceId: string;
  terminalId: string;
  /** Describes a terminal launch, not native turn/approval activity. */
  state: 'starting' | 'open';
}

export interface AssistantSnapshot {
  settings: AssistantSettings;
  profiles: AssistantProfile[];
  launches: AssistantLaunchOwner[];
  /** No assertion of machine-wide exclusivity is made. */
  externalActivity: 'unknown';
  discoveryError?: string;
  /**
   * Whether native profile discovery has completed in this main process. Profiles are memory-only, so
   * after a restart `false` means "not checked yet" (distinct from a checked, failed `discoveryError`).
   * Omitted by older producers; only an explicit `false` means unchecked.
   */
  profilesChecked?: boolean;
}

export interface AssistantLaunchRequest {
  profileId: string;
  workspaceId: string;
  /** Explicit acknowledgement that Clanker cannot establish external profile exclusivity. */
  acknowledgeExternalActivity: boolean;
}

export type AssistantLaunchResult = {
  action: 'focus' | 'created';
  workspaceId: string;
  terminalId: string;
  pid: number;
  harnessId: string;
  profileId: string;
  profileName: string;
  attentionEnabled: boolean;
};
