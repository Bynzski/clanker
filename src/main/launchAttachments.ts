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
  /**
   * Releases everything the attachment acquired. Called at most once by the coordinator, as a bare
   * function: it must not rely on `this`, and should close over only what releasing needs (never the
   * attachment's own args/env, which may carry credentials).
   */
  dispose(): void | Promise<void>;
  /**
   * Facts about what this launch can now honor, for LATER steps to read (never for their own authority:
   * a step still validates everything it relies on). Plain names; the coordinator attaches no meaning to
   * them and never merges what two attachments are. Only an attachment that really attached provides any.
   */
  provides?: readonly string[];
}

/** The launch as earlier attachments left it; attachments read it, never mutate it. */
export interface LaunchAttachmentState {
  readonly args: readonly string[];
  /** The user/harness environment plus what earlier attachments added (for conflict detection). */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Facts provided by the steps that attached before this one (see `PreparedHarnessAttachment.provides`). */
  readonly provided: ReadonlySet<string>;
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
  readonly provided: ReadonlySet<string>;
  /** Idempotent; resolves after every disposal has been attempted; never rejects. */
  dispose(): Promise<void>;
}

/** The error is for custom reporters (tests, diagnostics); the default never prints it. */
export type LaunchAttachmentErrorReporter = (stepName: string, phase: 'prepare' | 'dispose', error: unknown) => void;

const defaultReporter: LaunchAttachmentErrorReporter = (stepName, phase) => {
  // The generic layer cannot know what an attachment's exception text contains (a future attachment
  // may well carry a credential), so it reports only which step failed and when.
  console.warn(`[clanker-grid] launch attachment "${stepName}" ${phase} failed`);
};

export async function prepareLaunchAttachments(
  base: { args: readonly string[]; env: Readonly<Record<string, string | undefined>> },
  steps: readonly LaunchAttachmentStep[],
  report: LaunchAttachmentErrorReporter = defaultReporter,
): Promise<PreparedLaunchAttachments> {
  // Only disposers are retained once a step has been composed in. The attachment itself carries the
  // launch's args/env (credentials included) and must be collectable as soon as the child exists.
  const acquired: Array<{ name: string; dispose: () => void | Promise<void> }> = [];
  let args = [...base.args];
  let additions: Record<string, string> = {};
  const provided = new Set<string>();

  let disposal: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    disposal ??= (async () => {
      // Reverse acquisition order: later attachments may depend on earlier ones.
      for (const { name, dispose: release } of [...acquired].reverse()) {
        try { await release.call(undefined); } catch (error) { report(name, 'dispose', error); }
      }
    })();
    return disposal;
  };

  for (const step of steps) {
    try {
      const attachment = await step.prepare({ args, env: { ...base.env, ...additions }, provided: new Set(provided) });
      if (!attachment) continue;
      // The bare function, deliberately not bound to the attachment (a bound `this` would retain it).
      acquired.push({ name: step.name, dispose: attachment.dispose });
      if (attachment.args) args = [...attachment.args];
      if (attachment.env) additions = { ...additions, ...attachment.env };
      for (const fact of attachment.provides ?? []) provided.add(fact);
    } catch (error) {
      if (step.optional) {
        report(step.name, 'prepare', error);
        continue;
      }
      await dispose();
      throw error;
    }
  }

  return { args, env: additions, attached: acquired.map((entry) => entry.name), provided: new Set(provided), dispose };
}
