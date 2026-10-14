import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ASSISTANT_TAGLINE_LIMIT, ASSISTANT_TITLE_LIMIT, type AssistantCosmetics, type AssistantPresentation } from '../../../../shared/types/assistantPresentation';
import { useAssistantsStore } from '../../../store/assistantsStore';
import AssistantAvatar from '../../assistants/AssistantAvatar';
import { Button } from '../../ui/Button';
import { DetailSection } from '../../ui/DetailPresentation';
import { Field, FieldLabel, FormMessage } from '../../ui/Field';
import { Input } from '../../ui/Input';

const WRITE_MESSAGE = {
  saved: 'Saved in Hermes.',
  conflict: 'Hermes metadata changed concurrently. Authoritative values have been reloaded; review before saving again.',
  unsupported: 'This Hermes version does not support safe cosmetic updates.',
  invalid: 'Title or tagline was rejected. Use bounded text without control characters.',
  offline: 'Hermes is offline. Reconnect and reload values before retrying.',
  unavailable: 'Profile or connection changed. Reload values before retrying; an in-flight update may have reached Hermes.',
  error: 'Could not confirm the update. It may have reached Hermes. Reload authoritative values before retrying.',
};

/** Narrow Bot Mode cosmetics, never the operational role description. An edit token pins the user's baseline. */
export function AssistantAppearance({ assistantId, connected, revision, onRefresh }: { assistantId: string; connected: boolean; revision: number; onRefresh?: () => Promise<void> }) {
  const prefix = useId(); const epoch = useRef(0);
  const [baseline, setBaseline] = useState<(AssistantCosmetics & { assistantId: string })>();
  const [title, setTitle] = useState(''); const [tagline, setTagline] = useState('');
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const apply = useCallback((value: AssistantPresentation) => {
    const data = value.assistantId === assistantId && value.cosmetics.state === 'ready' ? value.cosmetics.data : undefined;
    setBaseline(data ? { ...data, assistantId } : undefined); setTitle(data?.title ?? ''); setTagline(data?.tagline ?? '');
  }, [assistantId]);
  useEffect(() => {
    const current = ++epoch.current; let cancelled = false;
    setBaseline(undefined); setMessage(''); setBusy(connected);
    if (!connected) return () => { cancelled = true; epoch.current = current + 1; };
    // The detail parent sequences explicit native refresh before changing revision.
    void window.electronAPI.getAssistantPresentation(assistantId).then((value) => {
      if (!cancelled && current === epoch.current) apply(value);
    }, () => { if (!cancelled && current === epoch.current) setBaseline(undefined); }).finally(() => {
      if (!cancelled && current === epoch.current) setBusy(false);
    });
    return () => { cancelled = true; epoch.current = current + 1; };
    // Roster cosmetics can change while the user types. Keep this baseline until an explicit reload/save.
  }, [assistantId, connected, revision, apply]);

  const reload = async () => {
    const current = epoch.current; setBusy(true); setMessage('');
    try {
      if (onRefresh) { await onRefresh(); return; }
      await useAssistantsStore.getState().refresh();
      const value = await window.electronAPI.getAssistantPresentation(assistantId);
      if (current === epoch.current) apply(value);
    } catch { if (current === epoch.current) setBaseline(undefined); }
    finally { if (current === epoch.current) setBusy(false); }
  };
  const save = async () => {
    if (!baseline?.editToken || baseline.assistantId !== assistantId || busy) return;
    const current = epoch.current; setBusy(true); setMessage('');
    try {
      const result = await window.electronAPI.updateAssistantPresentation(assistantId, { editToken: baseline.editToken, title, tagline });
      if (current !== epoch.current) return;
      if (result.presentation) apply(result.presentation); else setBaseline(undefined);
      setMessage(WRITE_MESSAGE[result.state]); setFailed(result.state !== 'saved');
    } catch {
      if (current === epoch.current) { setBaseline(undefined); setMessage(WRITE_MESSAGE.error); setFailed(true); }
    } finally { if (current === epoch.current) setBusy(false); }
  };
  const currentBaseline = baseline?.assistantId === assistantId ? baseline : undefined;
  return <DetailSection title="Bot appearance · Native Hermes">
    <div className="assistant-appearance-source"><AssistantAvatar assistantId={assistantId} connected={connected} large /><span>Local · {assistantId}</span></div>
    <FormMessage>Cosmetic Bot Mode title and tagline only. The profile ID and operational role description are not changed. Blank values use Hermes’ existing presentation fallback.</FormMessage>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <Field><FieldLabel htmlFor={`${prefix}-title`}>Bot title</FieldLabel><Input id={`${prefix}-title`} value={currentBaseline ? title : ''} maxLength={ASSISTANT_TITLE_LIMIT} disabled={!currentBaseline?.editToken || busy || !connected} onChange={(event) => setTitle(event.target.value)} /></Field>
      <Field><FieldLabel htmlFor={`${prefix}-tagline`}>Bot tagline</FieldLabel><Input id={`${prefix}-tagline`} value={currentBaseline ? tagline : ''} maxLength={ASSISTANT_TAGLINE_LIMIT} disabled={!currentBaseline?.editToken || busy || !connected} onChange={(event) => setTagline(event.target.value)} /></Field>
      <div className="assistant-appearance-actions"><Button type="submit" variant="secondary" size="sm" disabled={!currentBaseline?.editToken || busy || !connected || title === currentBaseline.title && tagline === currentBaseline.tagline}>Save appearance</Button><Button type="button" variant="ghost" size="sm" disabled={busy || !connected} onClick={() => void reload()}>Reload values</Button></div>
    </form>
    {!busy && !currentBaseline?.editToken && <FormMessage>Cosmetic editing unavailable: requires a connected Hermes backend with metadata revision support and safely representable fields.</FormMessage>}
    {message && <FormMessage variant={failed ? 'error' : 'description'} role={failed ? 'alert' : 'status'}>{message}</FormMessage>}
    <FormMessage>Existing PNG/JPEG avatars are shown; WebP uses a fallback. Avatar replacement is not available in Clanker. Change it in Hermes, then refresh profiles.</FormMessage>
  </DetailSection>;
}
