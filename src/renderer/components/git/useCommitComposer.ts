import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiCommitSettings } from '../../types/shared';

/** Scope-local draft and inference lifecycle. Git execution/serialization belongs to GitButton. */
export function useCommitComposer({ enabled, workspacePath, workspaceId, environmentId, checkoutContextId, revision,
  hasStaged, hasWorking, disabled, isCurrent, onCommit }: {
  enabled: boolean; workspacePath: string; workspaceId?: string; environmentId: string; checkoutContextId?: string; revision: string;
  hasStaged: boolean; hasWorking: boolean; disabled: boolean; isCurrent: () => boolean;
  onCommit: (message: string, stageAll: boolean) => Promise<{ success: boolean; error?: string; refreshError?: string }>;
}) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AiCommitSettings | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const generation = useRef(0);
  const draftRevision = useRef(0);
  const submissionLock = useRef(false);
  const submissionGeneration = useRef(0);
  const focusAfterSubmit = useRef(false);
  const live = useRef(true);
  const editMessage = useCallback((value: string) => {
    draftRevision.current++;
    setMessage(value);
  }, []);
  const identity = `${workspaceId ?? ''}\0${environmentId}\0${checkoutContextId ?? ''}\0${workspacePath}`;
  const latest = useRef({ enabled, revision, identity });
  latest.current = { enabled, revision, identity };
  useEffect(() => {
    editMessage(''); setError(null); setIsSubmitting(false);
    submissionGeneration.current++;
    submissionLock.current = false; focusAfterSubmit.current = false;
  }, [identity, editMessage]);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    generation.current++;
    setIsGenerating(false);
    if (!enabled) { setSettings(null); return; }
    void window.electronAPI.getAiCommitSettings().then((value) => {
      if (!cancelled && isCurrent()) setSettings(value);
    }).catch(() => { if (!cancelled) setSettings(null); });
    return () => { cancelled = true; };
  }, [enabled, identity, isCurrent]);

  const focusEditor = useCallback(() => {
    const input = inputRef.current;
    const dialog = input?.closest('[role="dialog"]');
    // Never steal focus from another page or a nested DiffViewer.
    if (input?.isConnected && (!dialog || dialog.contains(document.activeElement))) input.focus();
  }, []);
  useEffect(() => {
    if (!isSubmitting && focusAfterSubmit.current) { focusAfterSubmit.current = false; focusEditor(); }
  }, [isSubmitting, focusEditor]);
  const submit = async (stageAll = false) => {
    if (!enabled || disabled || submissionLock.current || !isCurrent()) return;
    if ((!stageAll && !hasStaged) || (stageAll && !hasWorking)) { setError('Stage changes before committing.'); return; }
    if (!message.trim()) { setError('Please enter a commit message'); return; }
    submissionLock.current = true;
    generation.current++;
    setIsGenerating(false); setIsSubmitting(true); setError(null);
    const request = ++submissionGeneration.current;
    const fresh = () => live.current && isCurrent() && latest.current.identity === identity && request === submissionGeneration.current;
    try {
      const result = await onCommit(message, stageAll);
      if (!fresh()) return;
      if (result.success) {
        editMessage('');
        focusAfterSubmit.current = true;
        if (result.refreshError) setError(result.refreshError);
      }
      else setError(result.error || 'Failed to create commit');
    } catch (reason) {
      if (fresh()) setError(reason instanceof Error ? reason.message : 'Failed to create commit');
    } finally {
      if (request === submissionGeneration.current) submissionLock.current = false;
      if (fresh()) setIsSubmitting(false);
    }
  };
  const generate = async () => {
    if (!enabled || disabled || !(hasStaged || hasWorking) || submissionLock.current || !settings?.enabled || environmentId !== 'local' || !isCurrent()) return;
    const request = ++generation.current;
    const draft = draftRevision.current;
    const snapshot = revision;
    const fresh = () => live.current && isCurrent() && latest.current.identity === identity && latest.current.enabled && request === generation.current;
    setIsGenerating(true); setError(null);
    try {
      const result = await window.electronAPI.generateCommitMessage(workspacePath, workspaceId, ...(checkoutContextId ? [checkoutContextId] : []));
      if (!fresh()) return;
      if (!result.success || !result.message) setError(result.error || 'Failed to generate commit message');
      else if (snapshot !== latest.current.revision) setError('Changes updated during generation. Generate the message again.');
      else if (draft === draftRevision.current) { editMessage(result.message); focusEditor(); }
      // Otherwise preserve edits made during inference.
    } catch (reason) {
      if (fresh()) setError(reason instanceof Error ? reason.message : 'Failed to generate commit message');
    } finally {
      if (fresh()) setIsGenerating(false);
    }
  };
  return { message, editMessage, error, inputRef, isGenerating, isSubmitting, submit, generate,
    aiEnabled: Boolean(settings?.enabled) && environmentId === 'local' };
}
