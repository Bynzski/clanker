import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KNOWN_HARNESS_IDS } from '../../../src/shared/harnessIds';

// Deliberately scoped: identity matching, renderer presentation, and provider
// internals are valid. Shared feature orchestrators must not dispatch on IDs.
const orchestrators = [
  'harnessCatalog.ts', 'harnessLaunch.ts', 'sessionHistory.ts', 'sessionLaunch.ts',
  'agentAttentionAdapters.ts', 'aiCommit.ts', 'ipc/terminalIpc.ts', 'ipc/sessionIpc.ts',
  'ipc/remoteSessionInvocation.ts', 'ipc/aiCommitIpc.ts',
  'remote/sshSessionDiscovery.ts', 'remote/sshAgentAttention.ts', 'remote/sshEnvironment.ts',
];
function dispatchLiterals(source: string): string[] {
  const tree = ts.createSourceFile('orchestrator.ts', source, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];
  const ids: ReadonlySet<string> = new Set(KNOWN_HARNESS_IDS);
  function visit(node: ts.Node): void {
    if (ts.isStringLiteralLike(node) && ids.has(node.text)) {
      const parent = node.parent;
      if (ts.isArrayLiteralExpression(parent) || ts.isCaseClause(parent)
        || ts.isBinaryExpression(parent) || ts.isPropertyAssignment(parent)) violations.push(node.text);
    }
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && ids.has(node.name.text)) violations.push(node.name.text);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return violations;
}
describe('harness architecture boundaries', () => {
  it.each(orchestrators)('%s does not rebuild a harness dispatch matrix', (file) => {
    expect(dispatchLiterals(readFileSync(resolve('src/main', file), 'utf8'))).toEqual([]);
  });
  it.each([
    "['codex', 'pi'].includes(harness)",
    "const supported = new Set(['codex', 'pi']); supported.has(harness)",
    "if ('codex' === harness) launch()",
    "switch(harness) { case 'pi': launch() }",
    "const dispatch = { codex: launch, 'pi': launch }",
  ])('rejects literal capability dispatch: %s', (source) => {
    expect(dispatchLiterals(source).length).toBeGreaterThan(0);
  });
});
