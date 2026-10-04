import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { hookNodeExecutable } from '../localAttention';

const AGY_PLUGIN_NAME = 'clanker-grid-attention';
const AGY_PLUGIN_OWNER_MARKER = '.clanker-grid-owner';
const AGY_PLUGIN_OWNER = 'clanker-grid:agy-attention:v1\n';
const AGY_GUARD_FILE = 'guard.mjs';
// Earlier builds installed an unmarked plugin under this name, matching every tool and pointing
// straight at a temp-directory script.
const LEGACY_AGY_PLUGIN_NAME = 'clanker-attention';
const LEGACY_AGY_PLUGIN_JSON = { name: 'clanker-attention', version: '1.0.0', description: 'Clanker Agent Attention Plugin' };
const LEGACY_COMMAND_PATTERN = /^node "([^"]*clanker-attention-[A-Za-z0-9]+[/\\]command\.mjs)" (\w+)$/;

/** The conversation is the subject: the first conversation to start binds as root and every
 * other one is reported with its own ID, so the broker rejects it. Antigravity exposes no turn
 * ID, so the interpreter keeps an epoch in the bridge store: `PreInvocation` #0 opens epoch N
 * for the root conversation and only that epoch can be answered or settled. `Stop` settles only
 * when Antigravity reports it fully idle (no background command or async task remains).
 * Location: hooks carry no cwd; every payload carries the conversation's `workspacePaths`, and a
 * command's Cwd never persists. A single workspace root is the root conversation's location
 * (reported on its turn start and settle); several roots are ambiguous and report nothing. */
export const INTERPRETER = `const ASK_TOOLS = ['ask_question', 'ask_permission', 'notify_user'];
export default function interpret(input, hook, store) {
  const sessionId = typeof input.conversationId === 'string' ? input.conversationId : undefined;
  const toolName = input.toolCall?.name;
  const asks = ASK_TOOLS.includes(toolName);
  const state = store.read();
  const root = !state.session || state.session === sessionId;
  const event = (type, fields) => ({ event: { type, scope: 'root', sessionId, nativeEvent: hook, ...fields } });
  const paths = Array.isArray(input.workspacePaths) ? input.workspacePaths : [];
  const cwd = root && paths.length === 1 && typeof paths[0] === 'string' && paths[0] ? paths[0] : undefined;
  const live = root && state.open === true ? String(state.epoch) : undefined;
  switch (hook) {
    case 'PreInvocation': {
      if (input.invocationNum !== 0) return null;
      if (!root) return event('turn_started');
      const epoch = live ? state.epoch : (Number.isInteger(state.epoch) ? state.epoch : 0) + 1;
      store.write({ session: sessionId, epoch, open: true });
      return event('turn_started', { turnId: String(epoch), cwd });
    }
    case 'PreToolUse': return asks ? { ...(live ? event('input_requested', { turnId: live, inputId: toolName, requestKind: 'input' }) : {}), output: { decision: 'allow' } } : null;
    case 'PostToolUse': return asks && live ? event('input_resolved', { turnId: live, inputId: toolName }) : null;
    case 'Stop':
      if (input.fullyIdle !== true || !live) return null;
      store.write({ ...state, open: false });
      return event('turn_completed', { turnId: live, cwd });
    default: return null;
  }
}
`;

/** Persistent shim referenced by the installed plugin. The plugin outlives Clanker (crash, hard
 * kill, temp cleanup), so this file must stay runnable and fail open: it only forwards to the
 * launch-scoped bridge when this is a Clanker Antigravity launch whose resources still exist, and
 * otherwise answers with Antigravity's neutral hook response and exit 0. */
export const GUARD = `import { spawn } from 'node:child_process';
import fs from 'node:fs';
let settled = false;
let timer;
// Every path converges here: exactly one JSON response is ever written, whatever the event order.
const finish = (text) => {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  process.stdout.write(text + '\\n', () => process.exit(0));
};
const neutral = () => finish('{}');
const LIMIT = 65536;
async function forward() {
  const env = process.env;
  const command = env.CLANKER_ATTENTION_COMMAND;
  const interpreter = env.CLANKER_ATTENTION_INTERPRETER;
  const hook = process.argv[2];
  if (!env.CLANKER_ATTENTION_TOKEN || env.CLANKER_ATTENTION_HARNESS !== 'agy' || !command || !interpreter || !hook) return neutral();
  fs.accessSync(command, fs.constants.R_OK);
  fs.accessSync(interpreter, fs.constants.R_OK);
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > LIMIT) break;
    chunks.push(chunk);
  }
  const child = spawn(process.execPath, [command, interpreter, hook], { stdio: ['pipe', 'pipe', 'ignore'], env });
  const out = [];
  let outSize = 0;
  child.stdout.on('data', (chunk) => { if (outSize < LIMIT) { out.push(chunk); outSize += chunk.length; } });
  child.stdin.on('error', () => {});
  child.on('error', neutral);
  child.on('close', (code) => {
    if (code !== 0) return neutral();
    try {
      const text = Buffer.concat(out).toString('utf8').trim();
      JSON.parse(text);
      finish(text);
    } catch { neutral(); }
  });
  const limit = Number(env.CLANKER_ATTENTION_GUARD_TIMEOUT_MS);
  timer = setTimeout(() => { neutral(); try { child.kill(); } catch { /* already gone */ } }, limit > 0 && limit < 8000 ? limit : 8000);
  child.stdin.end(Buffer.concat(chunks));
}
try { await forward(); } catch { neutral(); }
`;

function agyHooksJson(hook: (name: string) => string): Record<string, unknown> {
  const interactionTools = 'ask_question|ask_permission|notify_user';
  return {
    'clanker-attention': {
      PreInvocation: [{ type: 'command', command: hook('PreInvocation'), timeout: 10 }],
      PostInvocation: [{ type: 'command', command: hook('PostInvocation'), timeout: 10 }],
      PreToolUse: [{ matcher: interactionTools, hooks: [{ type: 'command', command: hook('PreToolUse'), timeout: 10 }] }],
      PostToolUse: [{ matcher: interactionTools, hooks: [{ type: 'command', command: hook('PostToolUse'), timeout: 10 }] }],
      Stop: [{ type: 'command', command: hook('Stop'), timeout: 10 }],
    },
  };
}

function agyPluginJson() {
  return {
    $schema: 'https://antigravity.google/schemas/v1/plugin.json',
    name: AGY_PLUGIN_NAME,
    description: 'Clanker agent attention plugin',
  };
}

/** Remote form: the host-side command and interpreter are referenced directly (the remote
 * installer wraps each command in its own environment guard). */
export function agyAttentionPlugin(command: string, interpreter: string, platform: NodeJS.Platform): {
  pluginJson: { $schema: string; name: string; description: string };
  hooksJson: Record<string, unknown>;
} {
  const nodeCommand = hookNodeExecutable(platform);
  return {
    pluginJson: agyPluginJson(),
    hooksJson: agyHooksJson((name) => `${nodeCommand} "${command}" "${interpreter}" ${name}`),
  };
}

/** Local form: only the persistent guard inside the plugin directory is referenced. */
export function localAgyAttentionPlugin(guard: string, platform: NodeJS.Platform) {
  const nodeCommand = hookNodeExecutable(platform);
  return { pluginJson: agyPluginJson(), hooksJson: agyHooksJson((name) => `${nodeCommand} "${guard}" ${name}`) };
}

function pluginsDirectory(homeDir: string): string {
  return path.join(homeDir, '.gemini', 'config', 'plugins');
}

/** The historical Clanker plugin, recognized by its exact payload: the known plugin.json, and a
 * hooks.json that is the known hook set whose every command runs one `clanker-attention-*` script. */
function legacyAttentionScript(directory: string): string | null {
  try {
    if (fs.readdirSync(directory).sort().join() !== 'hooks.json,plugin.json') return null;
    const pluginJson: unknown = JSON.parse(fs.readFileSync(path.join(directory, 'plugin.json'), 'utf8'));
    if (JSON.stringify(pluginJson) !== JSON.stringify(LEGACY_AGY_PLUGIN_JSON)) return null;
    const hooksText = fs.readFileSync(path.join(directory, 'hooks.json'), 'utf8');
    const hooks = JSON.parse(hooksText) as { 'clanker-attention'?: { PreInvocation?: Array<{ command?: unknown }> } };
    const first = hooks['clanker-attention']?.PreInvocation?.[0]?.command;
    const script = typeof first === 'string' ? LEGACY_COMMAND_PATTERN.exec(first)?.[1] : undefined;
    if (!script) return null;
    const expected = ((name: string) => `node "${script}" ${name}`);
    const shape = (matcher?: string) => (name: string) => (matcher
      ? [{ matcher, hooks: [{ type: 'command', command: expected(name), timeout: 10 }] }]
      : [{ type: 'command', command: expected(name), timeout: 10 }]);
    const known = { 'clanker-attention': {
      PreInvocation: shape()('PreInvocation'), PostInvocation: shape()('PostInvocation'),
      PreToolUse: shape('*')('PreToolUse'), PostToolUse: shape('*')('PostToolUse'), Stop: shape()('Stop'),
    } };
    return JSON.stringify(hooks) === JSON.stringify(known) ? script : null;
  } catch {
    return null;
  }
}

/** Removes the legacy plugin only when its provenance is established and its script is gone. */
export function removeStaleLegacyAgyAttentionPlugin(homeDir = os.homedir()): void {
  const directory = path.join(pluginsDirectory(homeDir), LEGACY_AGY_PLUGIN_NAME);
  const script = legacyAttentionScript(directory);
  if (!script || fs.existsSync(script)) return;
  try {
    for (const filename of ['plugin.json', 'hooks.json']) fs.rmSync(path.join(directory, filename), { force: true });
    fs.rmdirSync(directory);
  } catch {
    // Preserve anything unexpected rather than recursively deleting user data.
  }
}

/** One-time migration of the historical plugin. Safe to repeat: it acts only on that exact artifact. */
export const migrateLegacyAgyAttentionPlugin = removeStaleLegacyAgyAttentionPlugin;

function writeFileAtomically(file: string, content: string): void {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, content, { mode: 0o600 });
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

/** Installs or refreshes the owned plugin. It is deliberately persistent and never removed on
 * release, shutdown or startup: the directory is shared by every Clanker process (and by
 * Antigravity sessions that outlive them), and the guard keeps it inert unless a launch carries
 * Clanker's own attention environment. Writes are atomic and idempotent, so concurrent
 * installs by several processes converge on identical content. */
export function ensureAgyAttentionPlugin(
  homeDir = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): void {
  const directory = path.join(pluginsDirectory(homeDir), AGY_PLUGIN_NAME);
  migrateLegacyAgyAttentionPlugin(homeDir);
  if (fs.existsSync(directory)) {
    const marker = path.join(directory, AGY_PLUGIN_OWNER_MARKER);
    if (!fs.existsSync(marker) || fs.readFileSync(marker, 'utf8') !== AGY_PLUGIN_OWNER) {
      throw new Error(`Refusing to overwrite an unowned Antigravity plugin at ${directory}`);
    }
  } else {
    fs.mkdirSync(directory, { recursive: true });
  }

  // The guard exists before any hook references it; hooks.json is written last.
  writeFileAtomically(path.join(directory, AGY_PLUGIN_OWNER_MARKER), AGY_PLUGIN_OWNER);
  const guard = path.join(directory, AGY_GUARD_FILE);
  writeFileAtomically(guard, GUARD);
  const { pluginJson, hooksJson } = localAgyAttentionPlugin(guard, platform);
  writeFileAtomically(path.join(directory, 'plugin.json'), JSON.stringify(pluginJson, null, 2));
  writeFileAtomically(path.join(directory, 'hooks.json'), JSON.stringify(hooksJson, null, 2));
}
