import { useEffect, useState } from 'react';
import { Circle, ExternalLink, LoaderCircle, Play, RefreshCw, Square, TriangleAlert } from 'lucide-react';
import { isLiveWorkspaceService, type DevServiceCommand, type WorkspaceService } from '../../shared/types/workspaceServices';
import type { Terminal, WorkspaceTab } from '../store/workspaceTypes';
import { useWorkspaceServiceStore } from '../store/workspaceServiceStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useAssistantNavStore } from '../store/assistantNavStore';
import { useAgentLocation } from '../lib/useAgentLocation';
import { mainCheckoutContextId } from '../../shared/checkoutContext';
import { openUrlInWorkspaceBrowser } from '../lib/browserTabActions';
import { IconButton } from './ui/IconButton';
import { Button } from './ui/Button';
import ConfirmCloseDialog from './ConfirmCloseDialog';
import { devDependencyInstallCommand, installDevServiceDependencies } from '../lib/devServiceInstall';

export function DevServerControls({ workspace, command, service, terminalId, onStartFinished }: {
  workspace: WorkspaceTab; command?: DevServiceCommand; service?: WorkspaceService; terminalId?: string; onStartFinished?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmingInstall, setConfirmingInstall] = useState<DevServiceCommand | null>(null);
  const live = service && isLiveWorkspaceService(service);
  const stopping = service?.status === 'stopping';
  const starting = service?.status === 'starting';
  const failed = service?.status === 'failed';
  const text = live ? starting ? 'starting' : stopping ? 'stopping' : service.previewUrl ? new URL(service.previewUrl).host : 'running'
    : failed ? `exited${service.exitCode !== undefined ? ` (${service.exitCode})` : ''}` : command?.command ?? 'stopped';
  const action = async (run: () => Promise<void>) => {
    setBusy(true); setError(undefined);
    try { await run(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Dev server operation failed'); }
    finally { setBusy(false); }
  };
  const title = `${service?.cwd ?? command?.cwd ?? ''}\n${service?.command ?? command?.command ?? ''}${service?.error ? `\n${service.error}` : command?.preparationHint ? `\n${command.preparationHint}` : ''}`;
  return <div className="ws-service-item">
    <div className={`ws-service-row${failed ? ' failed' : ''}`} title={title}>
      {starting || stopping ? <LoaderCircle size={11} className="ws-service-spin" aria-hidden="true" />
        : failed ? <TriangleAlert size={11} aria-hidden="true" /> : <Circle size={8} fill={live ? 'currentColor' : 'none'} aria-hidden="true" />}
      <span className="ws-service-label">Dev Server · {text}</span>
      {!live && command?.preparationHint && terminalId && <Button className="ws-service-install" size="xs" variant="ghost" disabled={busy}
        aria-label="Install dependencies…" title={`Run ${devDependencyInstallCommand(command.packageManager)} in a visible terminal\n${command.cwd}`}
        onClick={() => setConfirmingInstall({ ...command })}>Install…</Button>}
      {!live && command && terminalId && <IconButton className="ws-nav-action" disabled={busy} aria-label={`Run Dev Server · ${command.command}`} title={`Run ${command.command}\n${command.cwd}`} onClick={() => void action(async () => {
        const result = await window.electronAPI.workspaceServiceStart({ workspaceId: workspace.id, terminalId, checkoutContextId: command.checkoutContextId, cwd: command.cwd, command: command.command });
        onStartFinished?.();
        if (!result.success) throw new Error(result.error || 'Could not start dev server');
      })}><Play size={12} /></IconButton>}
      {live && service && <IconButton className="ws-nav-action" disabled={busy || (stopping && !service.error)} aria-label="Stop Dev Server" title="Stop Dev Server" onClick={() => void action(async () => {
        const result = await window.electronAPI.workspaceServiceStop({ workspaceId: workspace.id, serviceId: service.id });
        if (!result.success) throw new Error(result.error || 'Could not stop dev server');
      })}><Square size={11} /></IconButton>}
      {live && service?.previewUrl && <IconButton className="ws-nav-action" disabled={busy || stopping} aria-label="Open Dev Server in Browser" title={`Open ${service.previewUrl}`} onClick={() => void action(async () => {
        useAssistantNavStore.getState().clearActive();
        useWorkspaceStore.getState().selectWorkspace(workspace.id);
        const url = service.previewUrl!;
        const probe = await window.electronAPI.probeRecipePreview(url, true);
        if (probe.status !== 'ready') throw new Error('Dev server preview is not reachable yet');
        const state = useWorkspaceStore.getState();
        const current = useWorkspaceServiceStore.getState().services.find((entry) => entry.id === service.id);
        if (state.activeWorkspaceId !== workspace.id || useAssistantNavStore.getState().activeAssistantId || current?.previewUrl !== url || !['starting', 'running'].includes(current.status)) return;
        if (!await openUrlInWorkspaceBrowser(workspace.id, url)) throw new Error('Could not open dev server preview');
      })}><ExternalLink size={12} /></IconButton>}
    </div>
    {!live && !failed && command?.preparationHint && <div className="ws-service-hint">{command.preparationHint}</div>}
    {failed && service?.error && <details className="ws-service-diagnostics">
      <summary>Why it failed</summary><pre>{service.error}</pre>
    </details>}
    {(error || (stopping && service?.error)) && <div className="ws-service-error" role="alert">{error || service?.error}</div>}
    <ConfirmCloseDialog
      isOpen={confirmingInstall !== null}
      title="Install dependencies in this checkout?"
      message={confirmingInstall ? `Run ${devDependencyInstallCommand(confirmingInstall.packageManager)} in ${confirmingInstall.cwd}? This opens a visible terminal. Installing downloads packages and can execute project and dependency install scripts. The dev server will not start automatically; click Run after installation finishes.` : ''}
      options={confirmingInstall && terminalId ? [{ label: 'Install dependencies', variant: 'primary', action: () => {
        const expected = confirmingInstall;
        setConfirmingInstall(null);
        void action(async () => { await installDevServiceDependencies(terminalId, expected); onStartFinished?.(); });
      } }] : []}
      onCancel={() => setConfirmingInstall(null)}
    />
  </div>;
}

/** Each conversation exposes discovery for its effective, registered checkout. Shared checkout = shared service. */
export default function DevServerRow({ workspace, terminal }: { workspace: WorkspaceTab; terminal: Terminal }) {
  const location = useAgentLocation(terminal.id);
  const contextId = location ? location.checkoutContextId : terminal.checkoutContextId ?? mainCheckoutContextId(workspace.id);
  const context = workspace.checkoutContexts?.find((entry) => entry.id === contextId);
  const key = `${workspace.id}:${terminal.id}:${contextId}:${context?.path}:${context?.missing}:${location?.path}`;
  const [attempt, setAttempt] = useState(0);
  const [discovery, setDiscovery] = useState<{ key: string; command?: DevServiceCommand; error?: string }>();
  const services = useWorkspaceServiceStore((state) => state.services);
  const service = services.find((entry) => entry.workspaceId === workspace.id && entry.checkoutContextId === contextId);
  const canDiscover = Boolean(context && !context.missing && (!workspace.environmentId || workspace.environmentId === 'local'));
  useEffect(() => {
    if (!canDiscover) return;
    let disposed = false;
    void window.electronAPI.workspaceServiceDiscover({ workspaceId: workspace.id, terminalId: terminal.id }).then((result) => {
      if (!disposed) setDiscovery({ key, command: result.command, error: result.success ? undefined : result.error });
    }).catch(() => { if (!disposed) setDiscovery({ key, error: 'Could not inspect dev command' }); });
    return () => { disposed = true; };
  }, [workspace.id, terminal.id, canDiscover, key, attempt]);
  const current = discovery?.key === key ? discovery : undefined;
  if (!service && !current?.command && !current?.error) return null;
  if (current?.error && !service) return <div className="ws-service-row" title={current.error}>
    <TriangleAlert size={11} aria-hidden="true" /><span className="ws-service-label">Dev Server unavailable</span>
    <IconButton className="ws-nav-action" aria-label="Retry dev command discovery" title={current.error} onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={12} /></IconButton>
  </div>;
  return <DevServerControls workspace={workspace} terminalId={terminal.id} command={current?.command} service={service} onStartFinished={() => setAttempt((value) => value + 1)} />;
}
