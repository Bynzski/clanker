import { COMPLETE_ISOLATED_CHECKOUT, CREATE_ISOLATED_CHECKOUT } from './lifecycleCapabilities';

/** Guidance never grants access or changes a launch binding. */
export function bridgeInstructions(granted: ReadonlySet<string>, liveRelocation = false): string {
  const lines = [
    'Clanker is the desktop workspace managing this agent. `clanker_context` describes its authorized launch checkout and authenticated observed location (read-only).',
    'Git owns worktree state. Use ordinary Git or provider-native tools for worktrees; refresh Clanker to discover changes. Observed locations do not grant access or move this conversation.',
    'Prefer selecting or creating a checkout in Clanker before launching a new agent. Closing or finishing an agent leaves its worktree intact; removal is a separate confirmed action.',
  ];
  const compatibility = [CREATE_ISOLATED_CHECKOUT, COMPLETE_ISOLATED_CHECKOUT].filter((name) => granted.has(name));
  if (compatibility.length) {
    lines.push(`Compatibility tools ${compatibility.map((name) => `\`${name}\``).join(', ')} remain available only for explicitly requested conversation relocation.`);
    if (granted.has(COMPLETE_ISOLATED_CHECKOUT)) lines.push('Complete also removes the old checkout; do not call it merely because a task is finished.');
    lines.push(liveRelocation
      ? 'After a successful compatibility move, continue this same turn only in the confirmed checkout.'
      : 'After calling a compatibility relocation tool, finish your reply without running more tools; the conversation resumes in the target on its next turn. This does not preserve the in-flight turn.');
  }
  return lines.join('\n');
}
