/** Read-only, display-safe Hermes projections. No native session handles, configuration or credentials. */
export type AssistantRead<T> = { state: 'ready'; data: T } | { state: 'offline' | 'unsupported' | 'error' | 'unavailable' };
export interface AssistantCapability { name: string; enabled?: boolean }
export interface AssistantProfileDetails {
  model?: string;
  provider?: string;
  skills?: AssistantCapability[];
  toolsets?: AssistantCapability[];
  mcpServers?: AssistantCapability[];
}
export interface AssistantActivity {
  model?: string;
  provider?: string;
  skillCount?: number;
  lastSession?: { title?: string; lastActive?: number };
  workerLastActive?: number;
}
export interface AssistantRoutine {
  id: string;
  name: string;
  enabled?: boolean;
  state?: string;
  schedule?: string;
  timezone?: string;
  nextRun?: string;
  lastRun?: string;
  lastResult?: string;
}
export interface AssistantRun {
  title?: string;
  startedAt?: number;
  endedAt?: number;
  source?: 'cron' | 'cron_output';
  /** Backend preview only; bounded and redacted. Never interpreted as a success or lifecycle signal. */
  preview?: string;
}
export interface AssistantDetails {
  assistantId: string;
  profile: AssistantRead<AssistantProfileDetails>;
  history: AssistantRead<{ title?: string; lastActive?: number }[]>;
  routines: AssistantRead<AssistantRoutine[]>;
}
