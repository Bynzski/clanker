import { localAttention, hookNodeExecutable } from '../localAttention';

export function claudeAttentionSettings(command: string, platform: NodeJS.Platform): {
  hooks: Record<string, Array<{ hooks: Array<{ type: string; command: string; args: string[]; timeout: number }> }>>;
} {
  const nodeCommand = hookNodeExecutable(platform);
  const hooks = Object.fromEntries(['UserPromptSubmit', 'Stop', 'PostToolUse', 'Notification', 'SessionEnd'].map((name) => [
    name, [{ hooks: [{ type: 'command', command: nodeCommand, args: [command], timeout: 2 }] }],
  ]));
  return { hooks };
}


export const local = localAttention(({ args, files: adapterFiles }) => {
    if (args.some((arg) => arg === '--bare' || arg === '--safe-mode' || arg.startsWith('--settings'))) return null;
    return { args: [...args, '--settings', adapterFiles.claudeSettings], env: {} };

});
