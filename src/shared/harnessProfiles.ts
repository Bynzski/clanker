/** Profile references are names, never CLI fragments or paths. */
export function isValidHarnessProfileName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64
    && /^[A-Za-z0-9]/.test(value) && !/[^A-Za-z0-9_-]/.test(value);
}
