import { findHarnessProvider, getHarnessProviders, type HarnessWithCapability } from './harnesses/registry';
export type AiCommitProvider = HarnessWithCapability<'aiCommit'>;

export interface AiCommitCommandConfig {
  command: string;
  args: string[];
  modelArg: string;
}

export interface CommitPromptContext {
  workspacePath: string;
  branchName: string | null;
  isDetached: boolean;
  changeSummary: string[];
  diffMode: 'staged' | 'working';
  diffSummary: string;
}

export function getAiCommitTimeoutMs(provider: AiCommitProvider): number {
  return findHarnessProvider(provider)?.aiCommit?.buildInvocation({ prompt: '' }).timeoutMs ?? 60000;
}

/** Legacy data surface projected from provider capabilities. */
export const AI_COMMIT_COMMANDS = Object.fromEntries(
  getHarnessProviders().filter((provider) => provider.aiCommit).map((provider) => {
    const capability = provider.aiCommit!;
    const invocation = capability.buildInvocation({ prompt: '' });
    return [provider.descriptor.id, { command: invocation.command, args: invocation.args, modelArg: capability.modelArg }];
  }),
) as Record<AiCommitProvider, AiCommitCommandConfig>;

export function buildAiCommitArgs(provider: AiCommitProvider, model: string | undefined): string[] {
  return findHarnessProvider(provider)?.aiCommit?.buildInvocation({ model, prompt: '' }).args ?? [];
}

export function buildCommitPrompt(context: CommitPromptContext): string {
  const branchLabel = context.branchName && context.branchName.length > 0
    ? context.branchName
    : context.isDetached
      ? 'Detached HEAD'
      : 'Unknown branch';

  const changeBlock = context.changeSummary.length > 0
    ? context.changeSummary.map((line) => `- ${line}`).join('\n')
    : '- No file changes detected';

  const diffSummary = context.diffSummary.trim().length > 0
    ? context.diffSummary.trim()
    : 'No diff summary available';

  return [
    'Write one git commit subject line with a brief description of the changes.',
    'Return only plain text.',
    'Format: feature: ..., fix: ..., restructure: ..., or chore: ...',
    'Choose feature for new capability, fix for a bug fix, restructure for refactor/plumbing/cleanup, chore for docs/tests/maintenance.',
    'Use imperative mood and keep it specific and concise.',
    'Prefer under 72 characters per line only adding a body if the change is complex.',
    '',
    `Repository: ${context.workspacePath}`,
    `Branch: ${branchLabel}`,
    `Commit scope: ${context.diffMode === 'staged' ? 'staged changes' : 'working tree changes'}`,
    '',
    'Changed files:',
    changeBlock,
    '',
    'Diff summary:',
    diffSummary,
    '',
    'Commit message:',
  ].join('\n');
}

export function normalizeCommitMessageOutput(output: string): string {
  const withoutAnsi = output.replace(/\u001B\[[0-9;]*m/g, '').trim();
  const withoutFence = withoutAnsi
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const lines = withoutFence
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const candidate = lines[0] ?? '';
  return candidate
    .replace(/^(commit message|subject|message)\s*:\s*/i, '')
    .replace(/^[-*•]\s*/, '')
    .replace(/^["'`]+/, '')
    .replace(/["'`]+$/, '')
    .trim();
}
