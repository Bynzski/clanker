import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_AGENT_BRIDGE_CAPABILITIES } from '../../../src/main/agentBridge/capabilities';
import { KNOWN_HARNESS_IDS } from '../../../src/shared/harnessIds';

const main = resolve('src/main');
const read = (path: string) => readFileSync(path, 'utf8');
const imports = (source: string) => [...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
const filesIn = (directory: string) => readdirSync(directory).filter((name) => name.endsWith('.ts')).map((name) => resolve(directory, name));

describe('agent bridge architecture contract', () => {
  it('the bridge never depends on attention: MCP is not a second lifecycle system', () => {
    for (const file of filesIn(resolve(main, 'agentBridge'))) {
      const offending = imports(read(file)).filter((specifier) => /attention/i.test(specifier));
      expect(offending, file).toEqual([]);
      expect(read(file), file).not.toMatch(/AgentAttentionBroker|markSubmitted|markLifecycleLost|receiveRemote/);
    }
  });

  it('provider bridge attachments are separate files that never touch attention', () => {
    for (const id of KNOWN_HARNESS_IDS) {
      let source: string;
      try { source = read(resolve(main, 'harnesses', id, 'agentBridge.ts')); } catch { continue; }
      expect(imports(source).filter((specifier) => /attention/i.test(specifier)), id).toEqual([]);
      expect(source, id).not.toMatch(/CLANKER_ATTENTION|HarnessAttentionCapability/);
    }
  });

  it('attention does not know about the bridge', () => {
    for (const file of [resolve(main, 'attentionLaunchStep.ts'), resolve(main, 'agentAttentionBroker.ts'), resolve(main, 'agentAttentionAdapters.ts')]) {
      expect(read(file), file).not.toMatch(/agentBridge|CLANKER_MCP/);
    }
  });

  it('the generic launch-attachment module knows neither capability', () => {
    const source = read(resolve(main, 'launchAttachments.ts'));
    // Free of dependencies entirely: it can only compose what steps hand it.
    expect(imports(source)).toEqual([]);
    expect(source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')).not.toMatch(/attention|agentBridge|CLANKER_MCP|credential/i);
  });

  it('exposes no model-invoked lifecycle tools and no authority-selecting arguments', () => {
    const source = read(resolve(main, 'agentBridge', 'capabilities.ts'));
    expect(source).not.toMatch(/i_am_working|i_am_done|i_need_input|change_cwd|delete_worktree|delete_branch/);
    // Every shipped schema is closed, executable (built by defineCapability) and identity-free.
    for (const capability of DEFAULT_AGENT_BRIDGE_CAPABILITIES) {
      expect(capability.inputSchema.additionalProperties, capability.name).toBe(false);
      expect(Object.keys(capability.inputSchema.properties), capability.name)
        .not.toEqual(expect.arrayContaining([expect.stringMatching(/terminal|workspace|checkout|environment|harness/i)]));
      expect(typeof capability.invoke, capability.name).toBe('function');
      expect('run' in capability, `${capability.name} exposes an unvalidated run()`).toBe(false);
    }
  });

  it('the credential is never written to argv, config or logs by shared bridge code', () => {
    const source = [...filesIn(resolve(main, 'agentBridge')), ...KNOWN_HARNESS_IDS.flatMap((id) => {
      try { return [resolve(main, 'harnesses', id, 'agentBridge.ts')]; } catch { return []; }
    })].flatMap((file) => { try { return [read(file)]; } catch { return []; } }).join('\n');
    expect(source).not.toMatch(/console\.(log|warn|error|info|debug)\([^)]*token/i);
    expect(source).not.toMatch(/writeFileSync\([^)]*\.token/);
  });
});
