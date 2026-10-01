import type { HarnessRemoteAttention } from '../types';
import { agyAttentionPlugin } from './attentionPlugin';

function plugin() {
  const agy = agyAttentionPlugin('$CLANKER_REMOTE_ATTENTION_COMMAND', 'linux');
  agy.pluginJson.name = 'clanker-grid-remote-attention';
  const legacyAgyHooks = JSON.stringify(agy.hooksJson);
  // The persistent plugin must be inert for ordinary host launches, including ask tools.
  const guardHooks = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record.command === 'string') {
      record.command = `if [ -n "$CLANKER_REMOTE_ATTENTION_TOKEN" ] && [ "$CLANKER_REMOTE_ATTENTION_HARNESS" = agy ] && [ -n "$CLANKER_REMOTE_ATTENTION_COMMAND" ] && [ -r "$CLANKER_REMOTE_ATTENTION_COMMAND" ]; then ${record.command}; else printf '{}\\n'; fi`;
    }
    Object.values(record).forEach(guardHooks);
  };
  guardHooks(agy.hooksJson);
  return { parts: ['.gemini', 'config', 'plugins', 'clanker-grid-remote-attention'],
    files: { 'plugin.json': JSON.stringify(agy.pluginJson), 'hooks.json': JSON.stringify(agy.hooksJson) },
    upgradeFile: 'hooks.json', legacyFile: legacyAgyHooks };
}
export const remote: HarnessRemoteAttention = {
  requiresNode: true,
  validate: ``,
  configure: ``,
  plugin,
};
