/** Strip launch-scoped attention credentials without loading harness providers. */
export function withoutAttentionEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  // Windows variable names are case-insensitive: no spelling of a reserved name survives.
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => {
    const key = entry[0].toUpperCase();
    return !key.startsWith('CLANKER_ATTENTION_') && !key.startsWith('CLANKER_REMOTE_ATTENTION_') && typeof entry[1] === 'string';
  }));
}
