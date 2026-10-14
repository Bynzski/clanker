import type { AssistantRead, AssistantRoutine, AssistantRun } from '../../shared/types/assistantDetails';
import { JOB_ID, parseRoutines, parseRuns, readSection } from './assistantDetails';

export type CronTarget = { kind: 'default' } | { kind: 'assistant'; assistantId: unknown };
export interface CronBinding {
  profile: string;
  token: string;
  live(): boolean;
  read(path: string, signal: AbortSignal): Promise<unknown>;
}

/** Bounded, on-demand authenticated reads only. Default is a namespace, never an Assistant. */
export class AssistantCronReader {
  private readonly pending = new Map<string, Promise<AssistantRead<AssistantRoutine[] | AssistantRun[]>>>();
  private readonly controllers = new Set<AbortController>();
  private epoch = 0;
  constructor(private readonly resolve: (target: CronTarget) => CronBinding | undefined) {}

  invalidate(): void {
    this.epoch++;
    for (const controller of this.controllers) controller.abort();
    this.pending.clear();
  }
  routines(target: CronTarget): Promise<AssistantRead<AssistantRoutine[]>> {
    return this.read(target) as Promise<AssistantRead<AssistantRoutine[]>>;
  }
  runs(target: CronTarget, jobId: unknown): Promise<AssistantRead<AssistantRun[]>> {
    if (typeof jobId !== 'string' || !JOB_ID.test(jobId)) return Promise.resolve({ state: 'unavailable' });
    return this.read(target, jobId) as Promise<AssistantRead<AssistantRun[]>>;
  }
  private read(target: CronTarget, jobId?: string): Promise<AssistantRead<AssistantRoutine[] | AssistantRun[]>> {
    const binding = this.resolve(target);
    if (!binding || !binding.live()) return Promise.resolve({ state: 'offline' });
    const key = `${binding.profile}/${jobId ?? ''}`;
    const existing = this.pending.get(key); if (existing) return existing;
    if (this.controllers.size >= 8) return Promise.resolve({ state: 'unavailable' });
    const epoch = this.epoch;
    const controller = new AbortController(); this.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const live = () => epoch === this.epoch && binding.live() && !controller.signal.aborted;
    const rest = async (path: string) => {
      if (!live()) throw new Error('Read no longer current');
      const value = await binding.read(path, controller.signal);
      // Remove the credential BEFORE any display projection truncates a string.
      return JSON.parse(JSON.stringify(value, (_key, raw: unknown) => typeof raw === 'string' ? raw.split(binding.token).join('[redacted]') : raw)) as unknown;
    };
    const jobsPath = `/api/cron/jobs?profile=${encodeURIComponent(binding.profile)}`;
    const operation = readSection(async () => {
      if (!jobId) return parseRoutines(await rest(jobsPath), binding.profile);
      const owns = async () => parseRoutines(await rest(jobsPath), binding.profile).some((job) => job.id === jobId);
      if (!await owns()) throw new Error('Job not owned');
      const runs = parseRuns(await rest(`/api/cron/jobs/${encodeURIComponent(jobId)}/runs?profile=${encodeURIComponent(binding.profile)}&limit=20`), binding.profile, jobId);
      if (!await owns()) throw new Error('Job no longer owned');
      return runs;
    }).then((result): AssistantRead<AssistantRoutine[] | AssistantRun[]> => epoch !== this.epoch || !binding.live() ? { state: 'unavailable' } : controller.signal.aborted ? { state: 'error' } : result).finally(() => {
      clearTimeout(timeout); this.controllers.delete(controller);
      if (this.pending.get(key) === operation) this.pending.delete(key);
    });
    this.pending.set(key, operation);
    return operation;
  }
}
