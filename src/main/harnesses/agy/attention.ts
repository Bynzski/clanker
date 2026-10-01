import { localAttention } from '../localAttention';
import { randomUUID } from 'node:crypto';
import { acquireAgyAttentionPlugin, releaseAgyAttentionPlugin } from './attentionPlugin';


export const local = localAttention(({ args }) => {
  return { args, env: {} };
}, ({ terminalId, files, homeDir, platform }) => {
  // A distinct lease permits repeated preparation and out-of-order disposal.
  const leaseId = `${terminalId}:${randomUUID()}`;
  acquireAgyAttentionPlugin(leaseId, files, homeDir, platform);
  return () => releaseAgyAttentionPlugin(leaseId);
});
