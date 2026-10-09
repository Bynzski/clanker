import { problem } from './statusModel';
import { currentVcsBudget } from './requestBudget';
import type { VcsProblem } from './types';

/** Per page: ample for 100-row provider pages, bounded even after decompression. */
export const MAX_VCS_RESPONSE_BYTES = 2 * 1024 * 1024;
export class ProviderFailure extends Error {
  constructor(readonly problem: VcsProblem) { super(problem.message); }
}
export async function readProviderBody(response: Response, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const declared = response.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_VCS_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw new ProviderFailure(problem('response-too-large'));
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let complete = false;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) { complete = true; break; }
      bytes += chunk.value.byteLength;
      const budget = currentVcsBudget();
      if (budget) {
        budget.bytesRead += chunk.value.byteLength;
        if (budget.bytesRead > 8 * 1024 * 1024) throw new ProviderFailure(problem('response-too-large'));
      }
      if (bytes > MAX_VCS_RESPONSE_BYTES) throw new ProviderFailure(problem('response-too-large'));
      // Copy the bounded portion: a small view must not retain a giant backing buffer.
      chunks.push(chunk.value.slice());
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return body;
  } finally {
    signal?.removeEventListener('abort', abort);
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
