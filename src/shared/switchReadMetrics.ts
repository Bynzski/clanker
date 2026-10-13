/** Argument/content-free counters. Fixed labels only; no request identity or payloads. */
export function createSwitchReadMetrics() {
  const counts: Record<string, number> = {};
  let active = 0;
  let peak = 0;
  return {
    snapshot: (resetPeak = false) => {
      const result = { counts: { ...counts }, active, peak };
      if (resetPeak) peak = active;
      return result;
    },
    record(label: string) { counts[label] = (counts[label] ?? 0) + 1; },
    begin(label: string) {
      counts[label] = (counts[label] ?? 0) + 1;
      peak = Math.max(peak, ++active);
      let done = false;
      return () => { if (!done) { done = true; active--; } };
    },
  };
}
