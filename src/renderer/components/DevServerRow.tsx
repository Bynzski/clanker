import { useEffect, useState } from 'react';
import { Download, ExternalLink, LoaderCircle, Play, Settings2, Square, TriangleAlert } from 'lucide-react';
import { isLiveWorkspaceService, type DevServiceCommand, type WorkspaceService } from '../../shared/types/workspaceServices';
import type { Terminal, WorkspaceTab } from '../store/workspaceTypes';
import { useWorkspaceServiceStore } from '../store/workspaceServiceStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useAssistantNavStore } from '../store/assistantNavStore';
import { useAgentLocation } from '../lib/useAgentLocation';
import { mainCheckoutContextId } from '../../shared/checkoutContext';
import { openUrlInWorkspaceBrowser } from '../lib/browserTabActions';
import { IconButton } from './ui/IconButton';
import ConfirmCloseDialog from './ConfirmCloseDialog';
import DevServerDiagnosticsDialog from './DevServerDiagnosticsDialog';
import DevServerSettingsDialog from './DevServerSettingsDialog';
import { devDependencyInstallCommand, installDevServiceDependencies } from '../lib/devServiceInstall';

export function DevServerControls({ workspace, command, service, terminalId, onStartFinished }: {
  workspace: WorkspaceTab; command?: DevServiceCommand; service?: WorkspaceService; terminalId?: string; onStartFinished?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const environmentKeys = command?.environmentKeys ?? service?.environmentKeys ?? [];
  const environmentHint = environmentKeys.length ? `\nConfigured environment: ${environmentKeys.join(', ')}` : '';
  const title = `${service?.cwd ?? command?.cwd ?? ''}\n${service?.command ?? command?.command ?? ''}${service?.error ? `\n${service.error}` : command?.preparationHint ? `\n${command.preparationHint}` : ''}${environmentHint}`;
  return <div className="ws-service-item">
    <div className={`ws-service-row${failed ? ' failed' : ''}`} title={title}>
      {starting || stopping ? <LoaderCircle size={11} className="ws-service-spin" aria-hidden="true" />
        : failed && service ? <IconButton className="ws-nav-action ws-service-status" aria-label="Show failure details" title={`Dev Server ${text}: show details`} onClick={() => setDiagnosticsOpen(true)}><TriangleAlert size={12} /></IconButton>
        : live ? <span className="ws-service-light" aria-hidden="true" /> : null}
      <span className="sr-only">Dev Server · {text}</span>
      {!live && command?.preparationHint && terminalId && <IconButton className="ws-nav-action" disabled={busy}
        aria-label="Install dependencies…" title={`Install dependencies (${devDependencyInstallCommand(command.packageManager)})\n${command.cwd}`}
        onClick={() => setConfirmingInstall({ ...command })}><Download size={12} /></IconButton>}
      {!live && command && terminalId && <IconButton className="ws-nav-action" disabled={busy} aria-label={`Run Dev Server · ${command.command}`} title={`${failed ? 'Restart' : 'Run'} ${command.command}\n${command.cwd}${environmentHint}`} onClick={() => void action(async () => {
        const result = await window.electronAPI.workspaceServiceStart({ workspaceId: workspace.id, terminalId, checkoutContextId: command.checkoutContextId, cwd: command.cwd, command: command.command, ...(command.settingsRevision ? { settingsRevision: command.settingsRevision } : {}) });
        onStartFinished?.();
        if (!result.success) throw new Error(result.error || 'Could not start dev server');
      })}><Play size={12} /></IconButton>}
      {command && terminalId && <IconButton className="ws-nav-action" disabled={busy || Boolean(live)} aria-label="Configure Dev Server" title={live ? 'Stop the dev server before changing settings' : `Checkout dev server settings\n${command.cwd}${environmentHint}`} onClick={() => setSettingsOpen(true)}><Settings2 size={12} /></IconButton>}
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
    {!live && !failed && command?.preparationHint && <div className="ws-service-hint sr-only" title={command.preparationHint}>Dependencies may need installation</div>}
    {failed && service && <DevServerDiagnosticsDialog service={service} open={diagnosticsOpen} onOpenChange={setDiagnosticsOpen} />}
    {(error || (stopping && service?.error)) && <div className="ws-service-error" role="alert">{error || service?.error}</div>}
    {settingsOpen && !live && command && terminalId && <DevServerSettingsDialog key={`${terminalId}:${command.checkoutContextId}:${command.cwd}`} command={command} terminalId={terminalId} onClose={() => setSettingsOpen(false)} onSaved={() => onStartFinished?.()} />}
    <ConfirmCloseDialog
      isOpen={confirmingInstall !== null}
      title="Install dependencies in this checkout?"
      message={confirmingInstall ? `Run ${devDependencyInstallCommand(confirmingInstall.packageManager)} in ${confirmingInstall.cwd}? Opens a terminal to download packages and run project/dependency install scripts. The dev server stays stopped.` : ''}
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
  if (current?.error && !service) return <div className="ws-service-item"><div className="ws-service-row failed" title={current.error}>
    <span className="sr-only">Dev Server unavailable</span>
    <IconButton className="ws-nav-action" aria-label="Retry dev command discovery" title={current.error} onClick={() => setAttempt((value) => value + 1)}><TriangleAlert size={12} /></IconButton>
  </div></div>;
  return <DevServerControls workspace={workspace} terminalId={terminal.id} command={current?.command} service={service} onStartFinished={() => setAttempt((value) => value + 1)} />;
}
