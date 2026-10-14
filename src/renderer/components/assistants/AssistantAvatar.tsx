import { useEffect, useState } from 'react';
import { UserRound } from 'lucide-react';
import type { AssistantAvatar as AvatarResult } from '../../../shared/types/assistantPresentation';
import { useAssistantsStore } from '../../store/assistantsStore';
import './AssistantsRoster.css';

/** Visible/selected local profiles only. Image data is a decoded, main-normalized PNG, never a backend URL. */
export default function AssistantAvatar({ assistantId, connected, large = false }: { assistantId: string; connected: boolean; large?: boolean }) {
  const revision = useAssistantsStore((state) => state.snapshot?.presentationRevision ?? 0);
  const [result, setResult] = useState<{ id: string; revision: number; value: AvatarResult }>();
  const [broken, setBroken] = useState('');
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    void window.electronAPI.getAssistantAvatar(assistantId).then((value) => {
      if (!cancelled) { setResult({ id: assistantId, revision, value }); setBroken(''); }
    }, () => { if (!cancelled) setResult({ id: assistantId, revision, value: { state: 'error' } }); });
    return () => { cancelled = true; };
  }, [assistantId, connected, revision]);
  const value = connected && result?.id === assistantId && result.revision === revision ? result.value : undefined;
  const image = value?.state === 'ready' ? value.data : null;
  const src = image?.dataUrl.startsWith('data:image/png;base64,') && image.dataUrl.length <= 180_000 && broken !== image.dataUrl ? image.dataUrl : undefined;
  const fallback = !connected ? 'Avatar offline' : value?.state === 'unsupported' ? 'Native avatar API or image format is not supported'
    : value?.state === 'error' ? 'Native avatar could not be read' : 'No native avatar available';
  return <span className={`assistant-avatar${large ? ' assistant-avatar-large' : ''}`} aria-hidden="true" title={src ? 'Native Hermes avatar' : fallback}>
    {src ? <img src={src} alt="" width={large ? 48 : 24} height={large ? 48 : 24} onError={() => setBroken(src)} /> : <UserRound size={large ? 24 : 14} strokeWidth={2} />}
  </span>;
}
