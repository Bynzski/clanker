const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

/** ISO-8601/RFC3339 with an explicit offset -> epoch ms; anything else is undefined (never local time). */
export function parseOffsetTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string' || !ISO_WITH_OFFSET.test(value.trim())) return undefined;
  // JS Date reliably handles at most millisecond precision; Python emits microseconds.
  const normalized = value.trim().replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1');
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? time : undefined;
}
