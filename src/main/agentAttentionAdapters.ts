import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface AttentionAdapterFiles {
  command: string;
  claudeSettings: string;
  opencodeDirectory: string;
  piExtension: string;
}

let files: AttentionAdapterFiles | null = null;

/** Keep observer credentials scoped to the launch that registered them. */
export function withoutAttentionEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] =>
    !entry[0].startsWith('CLANKER_ATTENTION_') && typeof entry[1] === 'string'));
}

const OBSERVER = `import net from 'node:net';
export async function emit(event, sessionId, turnId) {
  const port = Number(process.env.CLANKER_ATTENTION_PORT);
  const token = process.env.CLANKER_ATTENTION_TOKEN;
  const harness = process.env.CLANKER_ATTENTION_HARNESS;
  if (!token || !harness || !Number.isInteger(port) || port < 1) return;
  const payload = JSON.stringify({ version: 1, token, harness, event,
    ...(typeof sessionId === 'string' ? { sessionId: sessionId.slice(0, 128) } : {}),
    ...(typeof turnId === 'string' ? { turnId: turnId.slice(0, 128) } : {}) });
  await new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => socket.end(payload));
    socket.setTimeout(500, () => socket.destroy());
    socket.on('error', () => resolve());
    socket.on('close', () => resolve());
  });
}
`;

const COMMAND = `import { emit } from './observer.mjs';
if (process.argv[2] === '--ended') {
  await emit('session_ended');
  process.exit(0);
}
let input = {};
try {
  if (process.argv[2]) input = JSON.parse(process.argv[2].slice(0, 65536));
  else {
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 65536) break;
      chunks.push(chunk);
    }
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
} catch { /* malformed hook input is ignored */ }
const hook = input.hook_event_name;
const notification = input.notification_type;
const event = input.type === 'agent-turn-complete' || hook === 'Stop' ? 'turn_completed'
  : hook === 'UserPromptSubmit' ? 'turn_started'
  : hook === 'Notification' && (notification === 'permission_prompt' || notification === 'agent_needs_input') ? 'input_requested'
  : hook === 'PostToolUse' ? 'input_resolved'
  : hook === 'SessionEnd' ? 'session_ended'
  : null;
if (event) await emit(event, input.session_id || input['thread-id'], input.turn_id || input['turn-id']);
process.stdout.write('{}\\n');
`;

const PI = `import { emit } from './observer.mjs';
export default function (pi) {
  pi.on('agent_start', (_event, ctx) => emit('turn_started', ctx.sessionManager?.getSessionId?.()));
  pi.on('agent_settled', (_event, ctx) => emit('turn_completed', ctx.sessionManager?.getSessionId?.()));
  pi.on('session_shutdown', (_event, ctx) => emit('session_ended', ctx.sessionManager?.getSessionId?.()));
}
`;

const OPENCODE = `import { emit } from '../observer.mjs';
let activeSession = process.env.CLANKER_ATTENTION_SESSION_ID || null;
export const ClankerAttention = async () => ({
  event: async ({ event }) => {
    const type = event.type;
    const props = event.properties || {};
    const sessionId = props.sessionID || props.info?.id || props.session?.id;
    if (typeof sessionId !== 'string') return;
    if (!activeSession) activeSession = sessionId;
    if (sessionId !== activeSession) return;
    if (type === 'session.status' && props.status?.type === 'busy') await emit('turn_started', sessionId);
    else if (type === 'session.idle') await emit('turn_completed', sessionId);
    else if (type === 'permission.asked' || type === 'question.asked') await emit('input_requested', sessionId);
    else if (type === 'permission.replied' || type === 'question.replied' || type === 'question.rejected') await emit('input_resolved', sessionId);
    else if (type === 'session.deleted') await emit('session_ended', sessionId);
  },
});
`;

function hookNodeExecutable(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'node.exe' : 'node';
}

export function claudeAttentionSettings(command: string, platform: NodeJS.Platform): {
  hooks: Record<string, Array<{ hooks: Array<{ type: string; command: string; args: string[]; timeout: number }> }>>;
} {
  const nodeCommand = hookNodeExecutable(platform);
  const hooks = Object.fromEntries(['UserPromptSubmit', 'Stop', 'PostToolUse', 'Notification', 'SessionEnd'].map((name) => [
    name, [{ hooks: [{ type: 'command', command: nodeCommand, args: [command], timeout: 2 }] }],
  ]));
  return { hooks };
}

export function ensureAttentionAdapterFiles(): AttentionAdapterFiles {
  if (files) return files;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-attention-'));
  const opencodeDirectory = path.join(root, 'opencode');
  fs.mkdirSync(path.join(opencodeDirectory, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(root, 'observer.mjs'), OBSERVER, { mode: 0o600 });
  const command = path.join(root, 'command.mjs');
  fs.writeFileSync(command, COMMAND, { mode: 0o600 });
  const piExtension = path.join(root, 'pi.ts');
  fs.writeFileSync(piExtension, PI, { mode: 0o600 });
  fs.writeFileSync(path.join(opencodeDirectory, 'observer.mjs'), OBSERVER, { mode: 0o600 });
  fs.writeFileSync(path.join(opencodeDirectory, 'plugins', 'clanker-attention.js'), OPENCODE, { mode: 0o600 });
  const claudeSettings = path.join(root, 'claude-settings.json');
  fs.writeFileSync(claudeSettings, JSON.stringify(claudeAttentionSettings(command, process.platform)), { mode: 0o600 });
  files = { command, claudeSettings, opencodeDirectory, piExtension };
  return files;
}

export function removeAttentionAdapterFiles(): void {
  if (!files) return;
  fs.rmSync(path.dirname(files.command), { recursive: true, force: true });
  files = null;
}

/** Returns null when launch-time injection would replace user configuration. */
export function attentionLaunchOptions(
  harness: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  adapterFiles: AttentionAdapterFiles,
  sessionId?: string,
  platform: NodeJS.Platform = process.platform,
): { args: string[]; env: Record<string, string> } | null {
  if (harness === 'pi') return { args: [...args, '--extension', adapterFiles.piExtension], env: {} };
  if (harness === 'claude') {
    if (args.some((arg) => arg === '--bare' || arg === '--safe-mode' || arg.startsWith('--settings'))) return null;
    return { args: [...args, '--settings', adapterFiles.claudeSettings], env: {} };
  }
  if (harness === 'opencode') {
    if (env.OPENCODE_CONFIG_DIR || args.includes('--pure')) return null;
    return { args, env: {
      OPENCODE_CONFIG_DIR: adapterFiles.opencodeDirectory,
      ...(sessionId ? { CLANKER_ATTENTION_SESSION_ID: sessionId } : {}),
    } };
  }
  if (harness === 'codex') {
    const configPath = path.join(env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');
    const config = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
    if (/^\s*notify\s*=/m.test(config)
      || args.some((arg) => /(?:^|\.)notify\s*=/.test(arg) || arg === '-p' || arg === '--profile')) return null;
    const configArgs = ['-c', `notify=${JSON.stringify([hookNodeExecutable(platform), adapterFiles.command])}`];
    const subcommandIndex = args.findIndex((arg) => arg === 'resume' || arg === 'fork');
    return { args: subcommandIndex < 0
      ? [...configArgs, ...args]
      : [...args.slice(0, subcommandIndex), ...configArgs, ...args.slice(subcommandIndex)], env: {} };
  }
  return null;
}
