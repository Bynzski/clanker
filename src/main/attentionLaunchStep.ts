import type { NativeAttentionCapability } from '../shared/types/attentionSignal';
import { findHarnessProvider } from './harnesses/registry';
import type { AgentAttentionBroker } from './agentAttentionBroker';
import { ensureAttentionAdapterFiles, attentionSourceOptions, prepareLocalAttention } from './agentAttentionAdapters';
import { disposeAttentionSafely } from './harnesses/localAttention';
import type { PreparedLocalAttention } from './harnesses/types';
import type { PreparedLaunchAttachments, LaunchAttachmentStep } from './launchAttachments';

/**
 * Provided only when the provider's native hooks/plugin were actually prepared for THIS launch: attention
 * enabled in settings is not enough (user-owned config such as `--bare`, conflicting settings, hooks or
 * profiles make a provider decline, and the harness still launches without them).
 */
export const NATIVE_ATTENTION_ATTACHED = 'native-attention';

export interface AttentionLaunchStepInput {
  broker: AgentAttentionBroker;
  harness: string;
  terminalId: string;
  /** The user requested attention. Unsupported providers still register an unavailable capability. */
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
        const brokerEnv = await broker.register(terminalId, harness, { ...(rootSessionId ? { rootSessionId } : {}), ...attentionSourceOptions(harness), capability: !enabled ? { requested: false, attachment: 'disabled' }
          : prepared ? { requested: true, attachment: 'prepared' }
          : { requested: true, attachment: 'unavailable', reason: findHarnessProvider(harness)?.attention?.local ? 'configuration-conflict' : 'unsupported' } });
        return {
          ...(prepared ? { args: prepared.args } : {}),
          env: { ...brokerEnv, ...prepared?.env, CLANKER_ATTENTION_COMMAND: files.command },
          ...(prepared ? { provides: [NATIVE_ATTENTION_ATTACHED] } : {}),
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

/** Read the same acquisition facts the bridge grant reads. A failed optional step is unavailable. */
export function localAttentionCapability(harness: string, requested: boolean, attachments?: PreparedLaunchAttachments): NativeAttentionCapability {
  if (!requested) return { requested, attachment: 'disabled' };
  if (!findHarnessProvider(harness)?.attention?.local) return { requested, attachment: 'unavailable', reason: 'unsupported' };
  if (attachments?.provided.has(NATIVE_ATTENTION_ATTACHED)) return { requested, attachment: 'prepared' };
  return { requested, attachment: 'unavailable', reason: attachments?.attached.includes('attention') ? 'configuration-conflict' : 'preparation-failed' };
}
