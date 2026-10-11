/**
 * Display-only masking for email addresses rendered in the UI. Identity, keys and anything sent back to main
 * keep the real value; only the text a person sees goes through here.
 */

/**
 * Requires a dotted domain with a letter TLD. Callers pass account and identity text only: an SSH remote such
 * as `git@github.com:owner/repo.git` matches this shape too, so it must never be routed through the masker.
 */
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g;

/** "jaystabins@gmail.com" → "j***@gmail.com": the first character of the local part and the domain stay visible. */
export function maskEmailAddress(address: string): string {
  return `${address.slice(0, 1)}***${address.slice(address.lastIndexOf('@'))}`;
}

/** Masks every email address in display text; everything else is returned unchanged. */
export function maskEmailsInText(text: string): string {
  return text.replace(EMAIL_PATTERN, (address) => maskEmailAddress(address));
}
