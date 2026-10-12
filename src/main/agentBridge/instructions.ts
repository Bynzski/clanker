/** Guidance describes immutable launch authority, never movement or lifecycle ownership. */
export function bridgeInstructions(): string {
  return [
    'Clanker is the desktop workspace managing this agent. `clanker_context` describes its authorized launch checkout and authenticated observed location (read-only).',
    'Git owns worktree state. Use ordinary Git or provider-native tools for worktrees; refresh Clanker to discover changes. Observed locations do not grant access or move this conversation.',
    'Use New Session to choose main, an existing worktree, or a new worktree before launching a new session. Closing or finishing an agent leaves its worktree intact; removal is a separate confirmed action in Source Control → Worktrees.',
  ].join('\n');
}
