import { useEffect, useState } from 'react';
import { PromptDialog } from './ui/PromptDialog';
import { useAppPromptStore } from '../lib/appPrompt';

/** Always mounted, including with zero workspaces and while an Assistant owns the shell. */
export default function AppPromptHost() {
  const [closeId, setCloseId] = useState<string | null>(null);
  const prompt = useAppPromptStore((state) => state.queue[0]);
  useEffect(() => {
    const api = window.electronAPI;
    if (!api.onAppCloseRequest) return;
    const dispose = api.onAppCloseRequest(setCloseId);
    void api.appCloseReady(true);
    return () => { dispose(); void api.appCloseReady(false); };
  }, []);
  return <>
    {!closeId && prompt && <PromptDialog key={prompt.id} {...prompt.options} onAnswer={prompt.answer} />}
    {closeId && <PromptDialog key={closeId} title="Close Clanker?"
      description="Clanker still has running work. Closing will stop running sessions or services and cancel any sign-in in progress."
      cancelLabel="Keep Clanker Open" confirmLabel="Close Anyway"
      onAnswer={(confirmed) => { setCloseId(null); void window.electronAPI.respondAppClose(closeId, confirmed); }} />}
  </>;
}
