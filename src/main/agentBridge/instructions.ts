import { COMPLETE_ISOLATED_CHECKOUT, CREATE_ISOLATED_CHECKOUT } from './lifecycleCapabilities';

/**
 * The MCP server instructions a caller receives, built from what it was GRANTED (the credential is the
 * authority, so an agent that cannot call a tool is never told to). Guidance only: correctness and
 * authorization never depend on the model reading or following it.
 */
export function bridgeInstructions(granted: ReadonlySet<string>, liveRelocation = false): string {
  const lines = [
    'Clanker is the desktop workspace managing this agent. `clanker_context` describes the workspace and checkout you were launched in (read-only).',
  ];
  const create = granted.has(CREATE_ISOLATED_CHECKOUT);
  const complete = granted.has(COMPLETE_ISOLATED_CHECKOUT);
  if (create || complete) {
    lines.push('Checkout lifecycle belongs to Clanker while you run here. The tools below come from the `clanker-grid` MCP server; if they are not in your tool list, search for them by name before doing the work by hand.');
    if (create) {
      lines.push(`- When you need an isolated worktree or branch to work in, call \`${CREATE_ISOLATED_CHECKOUT}\` instead of creating or entering one yourself `
        + '(not `git worktree add`, and not your own worktree feature such as `EnterWorktree`).');
    }
    if (complete) {
      lines.push(`- When isolated work is merged or finished, call \`${COMPLETE_ISOLATED_CHECKOUT}\` instead of removing, exiting or deleting the checkout or its branch yourself `
        + '(not `git worktree remove`, `ExitWorktree`, or manual branch deletion).');
    }
    lines.push('These tools move this same conversation and keep Clanker\'s checkout ownership, status display and cleanup in sync; doing it by hand strands the conversation.');
    lines.push('Everything else is normal: use ordinary Git and GitHub tools for edits, commits, pushes, pull requests and merges.');
    lines.push(liveRelocation
      ? 'On a successful checkout move, continue this same turn in the confirmed checkout. A failure never permits manual checkout cleanup.'
      : 'After calling either tool, finish your reply without running more tools; the conversation continues in the new checkout on its next turn.');
  }
  return lines.join('\n');
}
