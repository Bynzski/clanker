const INHERITED_CREDENTIAL_PREFIXES = ['CLANKER_ATTENTION_', 'CLANKER_REMOTE_ATTENTION_', 'CLANKER_MCP_'];

/**
 * Launch credentials are issued per terminal and are never this process's own. When Clanker (or a
 * test run) is started from inside an agent terminal it inherits that agent's credentials, and every
 * child it spawns (usage probes, model discovery, wrappers) would otherwise report as that agent.
 * Removes them from `env` in place.
 */
export function dropInheritedLaunchCredentials(env: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase();
    if (INHERITED_CREDENTIAL_PREFIXES.some((prefix) => upper.startsWith(prefix))) delete env[key];
  }
}

/** Strip launch-scoped attention credentials without loading harness providers. */
export function withoutAttentionEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  // Windows variable names are case-insensitive: no spelling of a reserved name survives.
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => {
    const key = entry[0].toUpperCase();
    return !key.startsWith('CLANKER_ATTENTION_') && !key.startsWith('CLANKER_REMOTE_ATTENTION_') && typeof entry[1] === 'string';
  }));
}
