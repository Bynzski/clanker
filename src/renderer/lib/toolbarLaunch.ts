/**
 * How a toolbar harness launch resolves its harness and model. Shared by the one-click harness
 * pills and the isolated-agent control so both launch identically: a harness that is not visible
 * falls back to a plain terminal, and the workspace's model applies only to the workspace's own
 * harness on a local environment (remote models are resolved on the host).
 */
export function resolveToolbarLaunch(input: {
  harnessId: string;
  visibleHarnessIds: readonly string[];
  workspaceHarness: string;
  workspaceModel: string;
  environmentId?: string;
}): { harness: string | undefined; model: string | undefined } {
  const harness = input.harnessId && input.visibleHarnessIds.includes(input.harnessId) ? input.harnessId : undefined;
  const remote = Boolean(input.environmentId && input.environmentId !== 'local');
  const model = remote ? undefined : harness === input.workspaceHarness ? (input.workspaceModel || undefined) : undefined;
  return { harness, model };
}
