import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';

/**
 * Main-process event-loop delay, for attention diagnostics. Hooks deliver lifecycle events over a
 * loopback socket with a bounded wait, so a main process stalled for about a second can make a hook
 * give up; this records whether that has happened in this run.
 */
let histogram: IntervalHistogram | null = null;

export function startEventLoopDelayMonitor(): void {
  if (histogram) return;
  histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
}

/** Milliseconds since the monitor started; null before it starts. */
export function eventLoopDelay(): { maxMs: number; p99Ms: number; meanMs: number } | null {
  if (!histogram) return null;
  const ms = (ns: number) => Math.round(ns / 1e6);
  return { maxMs: ms(histogram.max), p99Ms: ms(histogram.percentile(99)), meanMs: ms(histogram.mean) };
}
