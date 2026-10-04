import { interpreterPath, localAttention } from '../localAttention';
import { ensureAgyAttentionPlugin } from './attentionPlugin';


export const local = localAttention(({ args, files }) => {
  // The persistent plugin guard reads the launch-scoped interpreter from here, so it never bakes
  // an ephemeral temp path into configuration that outlives this process.
  return { args, env: { CLANKER_ATTENTION_INTERPRETER: interpreterPath(files) } };
}, ({ homeDir, platform }) => {
  // The plugin is persistent and guard-protected, so there is nothing to release.
  ensureAgyAttentionPlugin(homeDir, platform);
  return () => undefined;
});
