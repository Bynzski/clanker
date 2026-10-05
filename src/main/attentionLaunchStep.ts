import type { AgentAttentionBroker } from './agentAttentionBroker';
import { ensureAttentionAdapterFiles, attentionSourceOptions, prepareLocalAttention } from './agentAttentionAdapters';
import { disposeAttentionSafely } from './harnesses/localAttention';
import type { PreparedLocalAttention } from './harnesses/types';
import type { LaunchAttachmentStep } from './launchAttachments';

export interface AttentionLaunchStepInput {
  broker: AgentAttentionBroker;
  harness: string;
  terminalId: string;
  /** The harness has local attention and the user enabled it. Otherwise only the broker registration is made. */
  enabled: boolean;
  platform?: NodeJS.Platform;
  /** Main-validated native session a non-fork resume continues; never renderer-supplied. */
  rootSessionId?: string;
}

/**
 * Local attention as a launch attachment. Behavior is unchanged from the former inline preparation:
 * provider options are prepared, the terminal is registered with the broker, and on any failure the
 * launch simply proceeds without attention (the step is optional, and releases itself first).
 */
export function attentionLaunchStep(input: AttentionLaunchStepInput): LaunchAttachmentStep {
  const { broker, harness, terminalId, enabled, rootSessionId } = input;
  return {
    name: 'attention',
    optional: true,
    async prepare(state) {
      let prepared: PreparedLocalAttention | null = null;
      try {
        const files = ensureAttentionAdapterFiles();
        if (enabled) {
          prepared = prepareLocalAttention(harness, {
            terminalId, args: [...state.args], env: state.env, files,
            platform: input.platform ?? process.platform, ...(rootSessionId ? { rootSessionId } : {}),
          }) ?? null;
        }
        const brokerEnv = await broker.register(terminalId, harness, { ...(rootSessionId ? { rootSessionId } : {}), ...attentionSourceOptions(harness) });
        return {
          ...(prepared ? { args: prepared.args } : {}),
          env: { ...brokerEnv, ...prepared?.env, CLANKER_ATTENTION_COMMAND: files.command },
          dispose() {
            disposeAttentionSafely(prepared);
            broker.release(terminalId);
          },
        };
      } catch (error) {
        disposeAttentionSafely(prepared);
        broker.release(terminalId);
        throw error;
      }
    },
  };
}
