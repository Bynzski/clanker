/**
 * Launch attachments: the one generic lifecycle for resources a harness launch acquires
 * (attention hooks, the agent MCP bridge, ...). Attachments share only acquisition, argv/env
 * composition, rollback and disposal mechanics. They stay distinct capabilities with their own
 * credentials and authority; this module knows nothing about either.
 *
 *   prepare (in order) -> compose args/env -> spawn PTY
 *     failure while preparing   -> roll back what was acquired (reverse order)
 *     failure while spawning    -> dispose everything
 *     PTY exit / kill / cleanup -> dispose everything
 *
 * Disposal is idempotent and never throws, so a cleanup failure cannot mask the launch failure
 * that triggered it.
 */

/** What a prepared attachment contributes to one launch and how it is released. */
export interface PreparedHarnessAttachment {
  /**
   * The complete argv for the launch, derived from the argv the attachment was handed (an
   * attachment may insert anywhere, e.g. before a `resume` subcommand). Omit to leave it unchanged.
   */
  args?: string[];
  /** Environment variables added for the child. Later attachments override earlier ones. */
  env?: Record<string, string>;
  /** Releases everything the attachment acquired. Called at most once by the coordinator. */
  dispose(): void | Promise<void>;
}

/** The launch as earlier attachments left it; attachments read it, never mutate it. */
export interface LaunchAttachmentState {
  readonly args: readonly string[];
  /** The user/harness environment plus what earlier attachments added (for conflict detection). */
  readonly env: Readonly<Record<string, string | undefined>>;
}

export interface LaunchAttachmentStep {
  /** Diagnostic label only. */
  readonly name: string;
  /**
   * An optional step that fails (or yields nothing) is rolled back by itself and skipped; the launch
   * proceeds without it. A required step that fails rolls back every earlier attachment and rejects.
   */
  readonly optional?: boolean;
  /**
   * Must release its own partial state before throwing. Returning null means "not attached".
   */
  prepare(state: LaunchAttachmentState): PreparedHarnessAttachment | null | Promise<PreparedHarnessAttachment | null>;
}

export interface PreparedLaunchAttachments {
  /** Final argv after every attachment. */
  readonly args: string[];
  /** Merged additions of all attachments (not including the base environment). */
  readonly env: Record<string, string>;
  /** Names of the steps that attached, in order. */
  readonly attached: readonly string[];
  /** Idempotent; resolves after every disposal has been attempted; never rejects. */
  dispose(): Promise<void>;
}

export type LaunchAttachmentErrorReporter = (stepName: string, phase: 'prepare' | 'dispose', error: unknown) => void;

const defaultReporter: LaunchAttachmentErrorReporter = (stepName, phase, error) => {
  // Name and message only: attachment errors must never carry credentials, and the stack adds nothing here.
  console.warn(`[clanker-grid] launch attachment "${stepName}" ${phase} failed:`, error instanceof Error ? error.message : String(error));
};

export async function prepareLaunchAttachments(
  base: { args: readonly string[]; env: Readonly<Record<string, string | undefined>> },
  steps: readonly LaunchAttachmentStep[],
  report: LaunchAttachmentErrorReporter = defaultReporter,
): Promise<PreparedLaunchAttachments> {
  const acquired: Array<{ name: string; attachment: PreparedHarnessAttachment }> = [];
  let args = [...base.args];
  let additions: Record<string, string> = {};

  let disposal: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    disposal ??= (async () => {
      // Reverse acquisition order: later attachments may depend on earlier ones.
      for (const { name, attachment } of [...acquired].reverse()) {
        try { await attachment.dispose(); } catch (error) { report(name, 'dispose', error); }
      }
    })();
    return disposal;
  };

  for (const step of steps) {
    try {
      const attachment = await step.prepare({ args, env: { ...base.env, ...additions } });
      if (!attachment) continue;
      acquired.push({ name: step.name, attachment });
      if (attachment.args) args = [...attachment.args];
      if (attachment.env) additions = { ...additions, ...attachment.env };
    } catch (error) {
      if (step.optional) {
        report(step.name, 'prepare', error);
        continue;
      }
      await dispose();
      throw error;
    }
  }

  return { args, env: additions, attached: acquired.map((entry) => entry.name), dispose };
}
