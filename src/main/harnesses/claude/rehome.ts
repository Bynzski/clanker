import type { HarnessCheckoutRehomeCapability } from '../types';

/**
 * Claude Code: a second `claude --resume <id>` launched in the target directory while the first process
 * is still waiting inside the request that asked for the move continues the same session file (verified
 * in the real app: main -> worktree -> main kept appending to one `<id>.jsonl`). The target is decided by
 * the launch directory, which Clanker sets from the checkout context; Claude has no equivalent option.
 */
export const checkoutRehome: HarnessCheckoutRehomeCapability = { mode: 'hot-replace' };
