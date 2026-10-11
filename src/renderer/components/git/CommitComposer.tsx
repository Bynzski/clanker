import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Textarea';
import { Field, FieldLabel, FormMessage } from '../ui/Field';
import type { useCommitComposer } from './useCommitComposer';

export function CommitComposer({ composer, stagedCount, workingCount, disabled, progress, statusKnown = true }: {
  composer: ReturnType<typeof useCommitComposer>; stagedCount: number; workingCount: number;
  disabled: boolean; progress: string | null; statusKnown?: boolean;
}) {
  const blocked = disabled || composer.isSubmitting;
  return <form className="source-control-commit" aria-label="Commit changes"
    onSubmit={(event) => { event.preventDefault(); void composer.submit(); }}>
    <Field>
      <div className="source-control-commit-heading">
        <FieldLabel htmlFor="commit-message">Commit Message</FieldLabel>
        {composer.aiEnabled && stagedCount + workingCount > 0 && <Button size="xs" type="button"
          disabled={blocked || composer.isGenerating} title="Generate commit message with AI"
          onClick={() => void composer.generate()}>
          {composer.isGenerating ? <Loader2 size={12} className="spin" /> : <Sparkles size={12} />} Generate
        </Button>}
      </div>
      <Textarea id="commit-message" ref={composer.inputRef} variant="mono" rows={3}
        placeholder="Describe your changes…" value={composer.message}
        onChange={(event) => composer.editMessage(event.target.value)} disabled={blocked} />
    </Field>
    <p className="source-control-commit-counts">{statusKnown ? `${stagedCount} staged · ${workingCount} unstaged entries` : 'Change counts unavailable'}</p>
    <div className="source-control-commit-actions">
      <Button size="sm" type="submit" variant={stagedCount ? 'primary' : 'secondary'}
        disabled={blocked || !stagedCount || !composer.message.trim()}>Commit Staged</Button>
      <Button size="sm" type="button" variant={stagedCount ? 'secondary' : 'primary'}
        disabled={blocked || !workingCount || !composer.message.trim()}
        onClick={() => void composer.submit(true)}>Stage All &amp; Commit</Button>
    </div>
    <div role="status" className="source-control-commit-progress">
      {progress && <><Loader2 size={12} className="spin" />{progress}</>}
      {composer.isGenerating && 'Generating commit message…'}
    </div>
    {composer.error && <FormMessage variant="error">{composer.error}</FormMessage>}
  </form>;
}
