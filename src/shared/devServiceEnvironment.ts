import { utf8ByteLength } from './utf8';

/** Non-secret project configuration only. Never a shell command or a toolchain override. */
const DEV_SERVICE_ENV_LIMIT = 32;
const RESERVED = /^(?:PATH|PATHEXT|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|SHELL|COMSPEC|SYSTEMROOT|WINDIR|TEMP|TMP|TMPDIR|PWD|OLDPWD|ENV|BASH_ENV|IFS|CDPATH|TERM|COLORTERM|TERM_PROGRAM|FORCE_COLOR|NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|ELECTRON_RUN_AS_NODE)$/i;
const RESERVED_PREFIX = /^(?:CLANKER_|NPM_|npm_config_|LD_|DYLD_|BASH_|PYTHON|RUBY|PERL|GIT_|SSH_)/i;

export function validateDevServiceEnvironment(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error('Environment must be a key/value object');
  const entries = Object.entries(input);
  if (entries.length > DEV_SERVICE_ENV_LIMIT) throw new Error(`At most ${DEV_SERVICE_ENV_LIMIT} environment variables are allowed`);
  const seen = new Set<string>();
  let bytes = 0;
  for (const [key, value] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) || RESERVED.test(key) || RESERVED_PREFIX.test(key) || ['__PROTO__', 'CONSTRUCTOR', 'PROTOTYPE'].includes(key.toUpperCase())) {
      throw new Error(`Environment variable ${key.slice(0, 64)} is reserved or invalid`);
    }
    if (seen.has(key.toUpperCase())) throw new Error(`Duplicate environment variable ${key}`);
    seen.add(key.toUpperCase());
    if (typeof value !== 'string' || value.length > 1024 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`Invalid value for ${key}`);
    bytes += utf8ByteLength(key + value);
  }
  if (bytes > 8192) throw new Error('Environment settings exceed 8 KiB');
  return Object.fromEntries(entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

/** The UI text format is deliberately not dotenv: no interpolation, quoting or executable syntax. */
export function parseDevServiceEnvironment(text: string): Record<string, string> {
  const entries: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error('Use one NAME=value per line');
    const key = line.slice(0, separator).trim();
    if (seen.has(key.toUpperCase())) throw new Error(`Duplicate environment variable ${key}`);
    seen.add(key.toUpperCase());
    entries.push([key, line.slice(separator + 1)]);
  }
  return validateDevServiceEnvironment(Object.fromEntries(entries));
}
